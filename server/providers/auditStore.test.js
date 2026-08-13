import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'

process.env.AUDIT_DB_PATH = path.join(tmpdir(), `audit-default-${process.pid}.db`)
const { createAuditStore } = await import('./auditStore.js')

test('persists a late audit callback without storing the audited URL', () => {
  const store = createAuditStore(':memory:')
  store.saveSubmission({ dataId: 'audit-1', kind: 'video', contentId: 'job-1' })
  store.saveResult({ dataId: 'audit-1', status: 'NORMAL', label: 'NORMAL' })
  const restored = store.findRecent('video', 'job-1', Date.now() - 1_000)
  assert.deepEqual(restored, {
    dataId: 'audit-1',
    kind: 'video',
    contentId: 'job-1',
    status: 'NORMAL',
    label: 'NORMAL',
    submittedAt: restored.submittedAt,
    updatedAt: restored.updatedAt,
  })
  assert.equal(JSON.stringify(restored).includes('http'), false)
  store.close()
})
