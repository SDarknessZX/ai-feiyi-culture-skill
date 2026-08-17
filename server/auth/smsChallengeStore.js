import { chmodSync, mkdirSync } from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function secureDigest(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex')
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function createSmsChallengeStore(dbPath, { secret } = {}) {
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('SMS_CHALLENGE_SECRET 至少需要 32 字节。')
  }
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA busy_timeout = 5000')
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS sms_login_challenges (
      phone_key TEXT PRIMARY KEY,
      code_digest TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0
    )
  `)
  if (dbPath !== ':memory:') {
    try {
      chmodSync(dbPath, 0o600)
    } catch {
      // Some container filesystems do not support chmod.
    }
  }

  const selectChallenge = db.prepare('SELECT * FROM sms_login_challenges WHERE phone_key = ?')
  const upsertChallenge = db.prepare(`
    INSERT INTO sms_login_challenges (phone_key, code_digest, sent_at, expires_at, failed_attempts)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(phone_key) DO UPDATE SET
      code_digest = excluded.code_digest,
      sent_at = excluded.sent_at,
      expires_at = excluded.expires_at,
      failed_attempts = 0
  `)
  const incrementFailures = db.prepare(`
    UPDATE sms_login_challenges SET failed_attempts = failed_attempts + 1 WHERE phone_key = ?
  `)
  const deleteChallenge = db.prepare('DELETE FROM sms_login_challenges WHERE phone_key = ?')
  const pruneChallenges = db.prepare('DELETE FROM sms_login_challenges WHERE expires_at < ?')
  let closed = false

  function phoneKey(phone) {
    return secureDigest(secret, `phone:${phone}`)
  }

  function codeDigest(phone, code) {
    return secureDigest(secret, `code:${phone}:${code}`)
  }

  return {
    reserve({ phone, code, sentAt, expiresAt, cooldownMs }) {
      const key = phoneKey(phone)
      const current = selectChallenge.get(key)
      if (current && sentAt - Number(current.sent_at) < cooldownMs) {
        return {
          accepted: false,
          retryAfterSeconds: Math.max(1, Math.ceil((cooldownMs - (sentAt - Number(current.sent_at))) / 1000)),
        }
      }
      upsertChallenge.run(key, codeDigest(phone, code), sentAt, expiresAt)
      return { accepted: true, retryAfterSeconds: Math.ceil(cooldownMs / 1000) }
    },
    consume({ phone, code, now, maxAttempts }) {
      const key = phoneKey(phone)
      const current = selectChallenge.get(key)
      if (!current || Number(current.expires_at) < now || Number(current.failed_attempts) >= maxAttempts) {
        if (current) deleteChallenge.run(key)
        return false
      }
      if (!safeEqual(current.code_digest, codeDigest(phone, code))) {
        if (Number(current.failed_attempts) + 1 >= maxAttempts) deleteChallenge.run(key)
        else incrementFailures.run(key)
        return false
      }
      deleteChallenge.run(key)
      return true
    },
    remove(phone) {
      deleteChallenge.run(phoneKey(phone))
    },
    prune(now) {
      return Number(pruneChallenges.run(now).changes || 0)
    },
    close() {
      if (closed) return
      closed = true
      db.close()
    },
  }
}
