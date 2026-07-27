import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { hasTosConfig, uploadBufferToTos } from './tosStorage.js'
import { createCompliantVideoBuffer } from './videoCompliance.js'
import { createVideoPosterBuffer } from './videoPoster.js'

// 生成视频的长期归档：文件进 TOS，记录进 SQLite（server/data/works.db）。
// 服务重启、Ark 临时链接过期后，作品仍可通过这里找回。

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(path.join(dataDir, 'works.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS works (
    task_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT '',
    template_title TEXT NOT NULL DEFAULT '',
    tos_key TEXT NOT NULL,
    video_url TEXT NOT NULL,
    poster_key TEXT NOT NULL DEFAULT '',
    poster_url TEXT NOT NULL DEFAULT '',
    watermark_flag TEXT NOT NULL DEFAULT '0',
    created_at TEXT NOT NULL
  )
`)

try {
  db.exec("ALTER TABLE works ADD COLUMN poster_key TEXT NOT NULL DEFAULT ''")
} catch {
  // 旧库已存在该字段。
}

try {
  db.exec("ALTER TABLE works ADD COLUMN poster_url TEXT NOT NULL DEFAULT ''")
} catch {
  // 旧库已存在该字段。
}

try {
  db.exec("ALTER TABLE works ADD COLUMN watermark_flag TEXT NOT NULL DEFAULT '0'")
} catch {
  // 旧库已存在该字段。
}

const selectWork = db.prepare(`
  SELECT task_id, mode, template_title, tos_key, video_url, poster_key, poster_url, watermark_flag, created_at
  FROM works
  WHERE task_id = ?
`)
const insertWork = db.prepare(`
  INSERT OR IGNORE INTO works
    (task_id, mode, template_title, tos_key, video_url, poster_key, poster_url, watermark_flag, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const updatePoster = db.prepare('UPDATE works SET poster_key = ?, poster_url = ? WHERE task_id = ?')
const updateCompliance = db.prepare(`
  UPDATE works
  SET tos_key = ?, video_url = ?, poster_key = ?, poster_url = ?, watermark_flag = ?
  WHERE task_id = ?
`)
const selectRecentUnmarked = db.prepare(`
  SELECT task_id
  FROM works
  WHERE created_at >= ? AND watermark_flag != '3'
  ORDER BY created_at ASC
`)

export function findArchivedVideo(taskId) {
  const row = selectWork.get(taskId)
  return row ? publicWork(row) : null
}

export async function archiveGeneratedVideo({ taskId, videoBuffer, mode = '', templateTitle = '' }) {
  const existing = findArchivedVideo(taskId)
  if (existing?.watermarkFlag === '3') return existing
  if (existing) return upgradeArchivedVideo(existing)

  if (!hasTosConfig()) {
    throw new Error('TOS 未配置，无法归档生成视频。')
  }

  if (!videoBuffer?.length) {
    throw new Error('合规视频内容为空，无法归档生成视频。')
  }

  const objectKey = `videos/${new Date().toISOString().slice(0, 10)}/${taskId}.mp4`
  const videoUrl = await uploadBufferToTos(videoBuffer, objectKey, 'video/mp4')
  const { posterKey, posterUrl } = await createAndUploadPoster(videoBuffer, taskId)
  const createdAt = new Date().toISOString()

  insertWork.run(taskId, mode, templateTitle, objectKey, videoUrl, posterKey, posterUrl, '3', createdAt)
  return {
    taskId,
    mode,
    templateTitle,
    videoUrl,
    posterUrl,
    watermarkFlag: '3',
    createdAt,
  }
}

export async function ensureArchivedVideoPoster(taskId) {
  let existing = findArchivedVideo(taskId)
  if (!existing) return null

  if (existing.watermarkFlag !== '3') {
    existing = await upgradeArchivedVideo(existing)
  }

  if (existing.posterUrl) return existing
  if (!hasTosConfig()) {
    throw new Error('TOS 未配置，无法为已归档视频补充合规封面。')
  }

  try {
    const response = await fetch(existing.videoUrl)
    if (!response.ok) return existing
    const body = Buffer.from(await response.arrayBuffer())
    const posterBody = await createVideoPosterBuffer(body, taskId)
    const posterKey = `videos/${new Date().toISOString().slice(0, 10)}/${taskId}.jpg`
    const posterUrl = await uploadBufferToTos(posterBody, posterKey, 'image/jpeg')
    updatePoster.run(posterKey, posterUrl, taskId)
    return { ...existing, posterUrl }
  } catch (error) {
    console.warn('补生成历史视频封面失败，将由前端兜底展示视频帧：', error)
    return existing
  }
}

export async function migrateRecentArchivedVideos({ onProgress } = {}) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 6)
  const rows = selectRecentUnmarked.all(cutoff.toISOString())
  const results = []

  for (let index = 0; index < rows.length; index += 1) {
    const taskId = rows[index].task_id
    onProgress?.({ current: index + 1, total: rows.length, taskId })
    try {
      const work = findArchivedVideo(taskId)
      if (!work) continue
      const migrated = await upgradeArchivedVideo(work)
      results.push({ taskId, status: 'migrated', videoUrl: migrated.videoUrl })
    } catch (error) {
      results.push({
        taskId,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}

async function upgradeArchivedVideo(existing) {
  if (!hasTosConfig()) {
    throw new Error('TOS 未配置，无法为历史视频补充 AI 标识。')
  }

  const videoBuffer = await createCompliantVideoBuffer({
    sourceUrl: existing.videoUrl,
    taskId: existing.taskId,
  })
  const date = existing.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10)
  // 不覆盖旧文件：迁移成功后再更新索引，原始文件仍可回退。
  const objectKey = `videos/compliant/${date}/${existing.taskId}.mp4`
  const videoUrl = await uploadBufferToTos(videoBuffer, objectKey, 'video/mp4')
  const { posterKey, posterUrl } = await createAndUploadPoster(videoBuffer, existing.taskId, `videos/compliant/${date}`)

  updateCompliance.run(objectKey, videoUrl, posterKey, posterUrl, '3', existing.taskId)
  return {
    ...existing,
    videoUrl,
    posterUrl,
    watermarkFlag: '3',
    tosKey: objectKey,
    posterKey,
  }
}

async function createAndUploadPoster(videoBuffer, taskId, objectPrefix = `videos/${new Date().toISOString().slice(0, 10)}`) {
  try {
    const posterBody = await createVideoPosterBuffer(videoBuffer, taskId)
    const posterKey = `${objectPrefix}/${taskId}.jpg`
    const posterUrl = await uploadBufferToTos(posterBody, posterKey, 'image/jpeg')
    return { posterKey, posterUrl }
  } catch (error) {
    console.warn('生成视频封面失败，将由前端兜底展示视频帧：', error)
    return { posterKey: '', posterUrl: '' }
  }
}

function publicWork(row) {
  return {
    taskId: row.task_id,
    mode: row.mode,
    templateTitle: row.template_title,
    tosKey: row.tos_key,
    videoUrl: row.video_url,
    posterKey: row.poster_key || '',
    posterUrl: row.poster_url || '',
    watermarkFlag: row.watermark_flag || '0',
    createdAt: row.created_at,
  }
}
