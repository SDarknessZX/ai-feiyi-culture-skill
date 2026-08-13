import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
mkdirSync(dataDir, { recursive: true })

export function createAuditStore(dbPath = path.join(dataDir, 'audits.db')) {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA busy_timeout = 5000')
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_audits (
      data_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      content_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROCESSING',
      label TEXT NOT NULL DEFAULT '',
      submitted_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_audits_content
      ON content_audits(kind, content_id, updated_at DESC);
  `)
  const upsertSubmission = db.prepare(`
    INSERT INTO content_audits (data_id, kind, content_id, status, label, submitted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(data_id) DO UPDATE SET
      kind = excluded.kind,
      content_id = excluded.content_id,
      status = excluded.status,
      label = excluded.label,
      updated_at = excluded.updated_at
  `)
  const updateResult = db.prepare(`
    UPDATE content_audits SET status = ?, label = ?, updated_at = ? WHERE data_id = ?
  `)
  const selectByDataId = db.prepare('SELECT * FROM content_audits WHERE data_id = ?')
  const selectByContent = db.prepare(`
    SELECT * FROM content_audits
    WHERE kind = ? AND content_id = ? AND updated_at >= ?
    ORDER BY updated_at DESC LIMIT 1
  `)
  const prune = db.prepare('DELETE FROM content_audits WHERE updated_at < ?')
  const remove = db.prepare('DELETE FROM content_audits WHERE data_id = ?')

  return {
    saveSubmission({ dataId, kind, contentId, status = 'PROCESSING', label = '' }) {
      const now = Date.now()
      upsertSubmission.run(dataId, kind, contentId, status, label, now, now)
    },
    saveResult({ dataId, status = '', label = '' }) {
      updateResult.run(status, label, Date.now(), dataId)
    },
    findByDataId(dataId) {
      return publicRow(selectByDataId.get(dataId))
    },
    findRecent(kind, contentId, cutoff) {
      return publicRow(selectByContent.get(kind, contentId, cutoff))
    },
    prune(cutoff) {
      return Number(prune.run(cutoff).changes || 0)
    },
    remove(dataId) {
      remove.run(dataId)
    },
    close() {
      db.close()
    },
  }
}

function publicRow(row) {
  if (!row) return null
  return {
    dataId: row.data_id,
    kind: row.kind,
    contentId: row.content_id,
    status: row.status,
    label: row.label,
    submittedAt: Number(row.submitted_at),
    updatedAt: Number(row.updated_at),
  }
}

export const auditStore = createAuditStore(process.env.AUDIT_DB_PATH?.trim() || undefined)

export function findStoredAudit(dataId) {
  return auditStore.findByDataId(dataId)
}
