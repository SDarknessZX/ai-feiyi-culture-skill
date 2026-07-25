import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { hasTosConfig, uploadBufferToTos } from './tosStorage.js'
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

const selectWork = db.prepare('SELECT video_url, template_title, poster_url FROM works WHERE task_id = ?')
const insertWork = db.prepare(`
  INSERT OR IGNORE INTO works (task_id, mode, template_title, tos_key, video_url, poster_key, poster_url, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
const updatePoster = db.prepare('UPDATE works SET poster_key = ?, poster_url = ? WHERE task_id = ?')

export function findArchivedVideo(taskId) {
  const row = selectWork.get(taskId)
  return row ? { videoUrl: row.video_url, templateTitle: row.template_title, posterUrl: row.poster_url || '' } : null
}

export async function archiveGeneratedVideo({ taskId, sourceUrl, mode = '', templateTitle = '' }) {
  const existing = findArchivedVideo(taskId)
  if (existing) return existing

  if (!hasTosConfig()) {
    throw new Error('TOS 未配置，无法归档生成视频。')
  }

  const response = await fetch(sourceUrl)
  if (!response.ok) {
    throw new Error(`下载生成视频失败：HTTP ${response.status}`)
  }
  const body = Buffer.from(await response.arrayBuffer())

  const objectKey = `videos/${new Date().toISOString().slice(0, 10)}/${taskId}.mp4`
  const videoUrl = await uploadBufferToTos(body, objectKey, 'video/mp4')
  let posterKey = ''
  let posterUrl = ''

  try {
    const posterBody = await createVideoPosterBuffer(body, taskId)
    posterKey = `videos/${new Date().toISOString().slice(0, 10)}/${taskId}.jpg`
    posterUrl = await uploadBufferToTos(posterBody, posterKey, 'image/jpeg')
  } catch (error) {
    console.warn('生成视频封面失败，将由前端兜底展示视频帧：', error)
  }

  insertWork.run(taskId, mode, templateTitle, objectKey, videoUrl, posterKey, posterUrl, new Date().toISOString())
  return { videoUrl, posterUrl }
}

export async function ensureArchivedVideoPoster(taskId) {
  const existing = findArchivedVideo(taskId)
  if (!existing || existing.posterUrl) return existing
  if (!hasTosConfig()) return existing

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
