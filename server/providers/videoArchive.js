import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { hasTosConfig, uploadBufferToTos } from './tosStorage.js'

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
    created_at TEXT NOT NULL
  )
`)

const selectWork = db.prepare('SELECT video_url, template_title FROM works WHERE task_id = ?')
const insertWork = db.prepare(`
  INSERT OR IGNORE INTO works (task_id, mode, template_title, tos_key, video_url, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`)

export function findArchivedVideo(taskId) {
  const row = selectWork.get(taskId)
  return row ? { videoUrl: row.video_url, templateTitle: row.template_title } : null
}

export async function archiveGeneratedVideo({ taskId, sourceUrl, mode = '', templateTitle = '' }) {
  const existing = findArchivedVideo(taskId)
  if (existing) return existing.videoUrl

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

  insertWork.run(taskId, mode, templateTitle, objectKey, videoUrl, new Date().toISOString())
  return videoUrl
}
