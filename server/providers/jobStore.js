import { chmodSync, mkdirSync } from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
mkdirSync(dataDir, { recursive: true })

export function createJobStore(dbPath = path.join(dataDir, 'jobs.db')) {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA busy_timeout = 5000')
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS creation_jobs (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL,
      template_id TEXT NOT NULL DEFAULT '',
      template_title TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT 'female',
      ark_task_id TEXT NOT NULL DEFAULT '',
      audit_data_id TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      input_image_url TEXT NOT NULL DEFAULT '',
      result_video_url TEXT NOT NULL DEFAULT '',
      migu_task_id TEXT NOT NULL DEFAULT '',
      migu_otoken TEXT NOT NULL DEFAULT '',
      token_settlement_status TEXT NOT NULL DEFAULT 'not_started',
      token_settlement_outcome TEXT NOT NULL DEFAULT '',
      medium_results_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  try {
    db.exec("ALTER TABLE creation_jobs ADD COLUMN audit_data_id TEXT NOT NULL DEFAULT ''")
  } catch {
    // 新库或旧库已经存在该字段。
  }
  if (dbPath !== ':memory:') {
    try {
      chmodSync(dbPath, 0o600)
    } catch {
      // 容器或只读文件系统不支持 chmod 时，沿用运行环境权限。
    }
  }

  const upsert = db.prepare(`
    INSERT INTO creation_jobs (
      job_id, status, progress, mode, template_id, template_title, gender, ark_task_id, audit_data_id,
      message, input_image_url, result_video_url, migu_task_id, migu_otoken,
      token_settlement_status, token_settlement_outcome, medium_results_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      status = excluded.status,
      progress = excluded.progress,
      mode = excluded.mode,
      template_id = excluded.template_id,
      template_title = excluded.template_title,
      gender = excluded.gender,
      ark_task_id = excluded.ark_task_id,
      audit_data_id = excluded.audit_data_id,
      message = excluded.message,
      input_image_url = excluded.input_image_url,
      result_video_url = excluded.result_video_url,
      migu_task_id = excluded.migu_task_id,
      migu_otoken = excluded.migu_otoken,
      token_settlement_status = excluded.token_settlement_status,
      token_settlement_outcome = excluded.token_settlement_outcome,
      medium_results_json = excluded.medium_results_json,
      updated_at = excluded.updated_at
  `)
  const selectRecent = db.prepare('SELECT * FROM creation_jobs WHERE updated_at >= ? ORDER BY created_at ASC')
  const removeOlderThan = db.prepare('DELETE FROM creation_jobs WHERE updated_at < ?')
  const selectOne = db.prepare('SELECT * FROM creation_jobs WHERE job_id = ?')

  function save(jobId, job) {
    const now = Date.now()
    const createdAt = Number(job.createdAt) || now
    const updatedAt = Number(job.updatedAt) || now
    upsert.run(
      jobId,
      job.status || 'queued',
      Number(job.progress) || 0,
      job.mode || '',
      job.templateId || '',
      job.templateTitle || '',
      job.gender || 'female',
      job.arkTaskId || '',
      job.auditDataId || '',
      job.message || '',
      job.inputImageUrl || '',
      job.resultVideoUrl || '',
      job.miguTaskId || '',
      encryptToken(job.miguOtoken || ''),
      job.tokenSettlementStatus || 'not_started',
      job.tokenSettlementOutcome || '',
      JSON.stringify(Array.isArray(job.mediumResults) ? job.mediumResults : []),
      createdAt,
      updatedAt,
    )
  }

  return {
    save,
    find(jobId) {
      return fromRow(selectOne.get(jobId))
    },
    loadRecent(cutoff) {
      return selectRecent.all(cutoff).map((row) => [row.job_id, fromRow(row)])
    },
    prune(cutoff) {
      return Number(removeOlderThan.run(cutoff).changes || 0)
    },
    close() {
      db.close()
    },
  }
}

function fromRow(row) {
  if (!row) return null
  let mediumResults = []
  try {
    mediumResults = JSON.parse(row.medium_results_json || '[]')
  } catch {
    mediumResults = []
  }
  return {
    status: row.status,
    progress: Number(row.progress) || 0,
    mode: row.mode,
    templateId: row.template_id,
    templateTitle: row.template_title,
    gender: row.gender || 'female',
    arkTaskId: row.ark_task_id,
    auditDataId: row.audit_data_id,
    message: row.message,
    inputImageUrl: row.input_image_url,
    resultVideoUrl: row.result_video_url,
    miguTaskId: row.migu_task_id,
    miguOtoken: decryptToken(row.migu_otoken),
    tokenSettlementStatus: row.token_settlement_status,
    tokenSettlementOutcome: row.token_settlement_outcome,
    mediumResults,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function encryptionKey() {
  const secret = process.env.JOB_STORE_ENCRYPTION_KEY || process.env.AIGC_SIGNING_SECRET || process.env.AUDIT_APP_KEY || ''
  return secret ? crypto.createHash('sha256').update(secret).digest() : null
}

function encryptToken(value) {
  if (!value) return ''
  const key = encryptionKey()
  if (!key) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`
}

function decryptToken(value) {
  if (!value?.startsWith('v1.')) return ''
  const key = encryptionKey()
  if (!key) return ''
  try {
    const [, ivValue, tagValue, bodyValue] = value.split('.')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(bodyValue, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}

const defaultJobStore = createJobStore(process.env.JOB_DB_PATH?.trim() || undefined)

export function saveStoredJob(jobId, job) {
  defaultJobStore.save(jobId, job)
}

export function loadStoredJobs(cutoff) {
  return defaultJobStore.loadRecent(cutoff)
}

export function pruneStoredJobs(cutoff) {
  return defaultJobStore.prune(cutoff)
}
