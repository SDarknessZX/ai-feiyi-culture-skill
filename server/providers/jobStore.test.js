import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const defaultDir = mkdtempSync(path.join(tmpdir(), 'jobs-default-'))
process.env.JOB_DB_PATH = path.join(defaultDir, 'jobs.db')
const { createJobStore } = await import('./jobStore.js')

test('persists enough creation state to resume after a process restart', () => {
  const previousKey = process.env.JOB_STORE_ENCRYPTION_KEY
  process.env.JOB_STORE_ENCRYPTION_KEY = 'test-job-store-encryption-key'
  const testDir = mkdtempSync(path.join(tmpdir(), 'jobs-resume-'))
  const dbPath = path.join(testDir, 'jobs.db')
  const store = createJobStore(dbPath)
  const now = Date.now()
  store.save('job-resume', {
    status: 'running',
    progress: 72,
    mode: 'food',
    templateId: '糖醋排骨',
    templateTitle: 'AI识别美食',
    gender: 'female',
    arkTaskId: 'ark-task-1',
    auditDataId: 'audit-task-1',
    linkedJobId: 'job-linked-1',
    code: 'TEST_ERROR_CODE',
    message: '视频正在生成',
    inputImageUrl: 'https://example.test/input.jpg',
    miguTaskId: 'migu-task-1',
    miguOtoken: 'private-token',
    tokenSettlementStatus: 'pending',
    mediumResults: [{ contentType: 'image', content: 'https://example.test/reference.jpg' }],
    createdAt: now - 100,
    updatedAt: now,
  })

  store.close()
  const reopened = createJobStore(dbPath)
  const restored = reopened.find('job-resume')
  assert.equal(restored.arkTaskId, 'ark-task-1')
  assert.equal(restored.auditDataId, 'audit-task-1')
  assert.equal(restored.linkedJobId, 'job-linked-1')
  assert.equal(restored.code, 'TEST_ERROR_CODE')
  assert.equal(restored.inputImageUrl, 'https://example.test/input.jpg')
  assert.equal(restored.miguOtoken, 'private-token')
  assert.equal(restored.mediumResults.length, 1)
  assert.equal(reopened.loadRecent(now - 1_000).length, 1)
  reopened.close()
  rmSync(testDir, { recursive: true, force: true })
  if (previousKey === undefined) delete process.env.JOB_STORE_ENCRYPTION_KEY
  else process.env.JOB_STORE_ENCRYPTION_KEY = previousKey
})
