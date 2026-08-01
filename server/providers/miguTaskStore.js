import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

// 咪咕 taskId 是问题排查的唯一标识，不能只保存在进程内存中。
// 与作品归档分库存放，避免作品表只在生成成功后才有记录的问题。
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
mkdirSync(dataDir, { recursive: true })

const dbPath = process.env.MIGU_TASK_DB_PATH?.trim() || path.join(dataDir, 'migu-tasks.db')
const db = new DatabaseSync(dbPath)
db.exec(`
  CREATE TABLE IF NOT EXISTS migu_token_tasks (
    job_id TEXT PRIMARY KEY,
    migu_task_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT '',
    task_status TEXT NOT NULL DEFAULT 'received',
    settlement_status TEXT NOT NULL DEFAULT 'not_started',
    settlement_outcome TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`)

const insertTask = db.prepare(`
  INSERT INTO migu_token_tasks
    (job_id, migu_task_id, mode, task_status, settlement_status, settlement_outcome, last_error, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, '', '', ?, ?)
  ON CONFLICT(job_id) DO UPDATE SET
    migu_task_id = excluded.migu_task_id,
    mode = excluded.mode,
    task_status = excluded.task_status,
    settlement_status = excluded.settlement_status,
    updated_at = excluded.updated_at
`)

const updateTaskState = db.prepare(`
  UPDATE migu_token_tasks
  SET task_status = ?, last_error = ?, updated_at = ?
  WHERE job_id = ?
`)

const updateSettlement = db.prepare(`
  UPDATE migu_token_tasks
  SET settlement_status = ?, settlement_outcome = ?, last_error = ?, updated_at = ?
  WHERE job_id = ?
`)

export function recordMiguTokenTask({ jobId, miguTaskId, mode, taskStatus = 'received', settlementStatus = 'not_started' }) {
  const now = new Date().toISOString()
  insertTask.run(jobId, miguTaskId, mode || '', taskStatus, settlementStatus, now, now)
}

export function updateMiguTokenTaskState(jobId, taskStatus, error = '') {
  updateTaskState.run(taskStatus, error, new Date().toISOString(), jobId)
}

export function updateMiguTokenSettlement(jobId, settlementStatus, settlementOutcome = '', error = '') {
  updateSettlement.run(settlementStatus, settlementOutcome, error, new Date().toISOString(), jobId)
}
