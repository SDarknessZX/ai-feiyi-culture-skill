import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'

process.env.AUDIT_DB_PATH = path.join(tmpdir(), `content-audit-${process.pid}.db`)
const { checkContent, classifyStoredAudit, encryptAuditUrl, handleAuditCallback, isAuditServiceUnavailable } = await import('./contentAudit.js')

test('classifies persisted callback states without treating provider failures as content rejection', () => {
  assert.deepEqual(classifyStoredAudit(null), { state: 'pending', label: 'PROCESSING' })
  assert.deepEqual(classifyStoredAudit({ status: 'SUCCESS', label: 'NORMAL' }), { state: 'passed', label: 'NORMAL' })
  assert.deepEqual(classifyStoredAudit({ status: 'SUCCESS', label: 'REJECT' }), { state: 'rejected', label: 'REJECT' })
  assert.deepEqual(classifyStoredAudit({ status: 'FAILED', label: '' }), { state: 'unavailable', label: 'FAILED' })
})

test('encrypts media URLs with the official AES-CBC parameters', () => {
  const previousAppKey = process.env.AUDIT_APP_KEY
  process.env.AUDIT_APP_KEY = '1234567890abcdef'
  try {
    assert.equal(
      encryptAuditUrl('https://example.test/input.jpg'),
      'viYoQi9i55rRU3gGKg7UF465MWX1zX5YjC7bajhTACY=',
    )
  } finally {
    restoreEnv('AUDIT_APP_KEY', previousAppKey)
  }
})

test('handles an audit service business error without an unhandled rejection', async () => {
  const previous = {
    baseUrl: process.env.AUDIT_API_BASE_URL,
    account: process.env.AUDIT_ACCOUNT,
    appKey: process.env.AUDIT_APP_KEY,
    failOpen: process.env.AUDIT_FAIL_OPEN_ON_ERROR,
    fetch: globalThis.fetch,
  }

  process.env.AUDIT_API_BASE_URL = 'https://audit.example.test'
  process.env.AUDIT_ACCOUNT = 'test-account'
  process.env.AUDIT_APP_KEY = '1234567890abcdef'
  process.env.AUDIT_FAIL_OPEN_ON_ERROR = 'false'
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ code: '199999', info: '系统繁忙，请稍后重试' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  try {
    const result = await checkContent({
      kind: 'picture',
      content: 'https://example.test/input.jpg',
      contentId: 'audit-error-test',
      description: 'audit error regression test',
    })
    assert.equal(result.passed, false)
    assert.equal(result.label, 'ERROR_FAIL_CLOSED')
    assert.match(result.error, /系统繁忙/)
    assert.match(result.error, /code=199999/)
    assert.equal(isAuditServiceUnavailable(result), true)

    // Let the microtask queue drain; the test runner will flag any leaked rejection.
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    restoreEnv('AUDIT_API_BASE_URL', previous.baseUrl)
    restoreEnv('AUDIT_ACCOUNT', previous.account)
    restoreEnv('AUDIT_APP_KEY', previous.appKey)
    restoreEnv('AUDIT_FAIL_OPEN_ON_ERROR', previous.failOpen)
    globalThis.fetch = previous.fetch
  }
})

test('preserves the audit dataId when the provider rejects an image', async () => {
  const previous = {
    baseUrl: process.env.AUDIT_API_BASE_URL,
    account: process.env.AUDIT_ACCOUNT,
    appKey: process.env.AUDIT_APP_KEY,
    fetch: globalThis.fetch,
  }
  process.env.AUDIT_API_BASE_URL = 'https://audit.example.test'
  process.env.AUDIT_ACCOUNT = 'test-account'
  process.env.AUDIT_APP_KEY = '1234567890abcdef'
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: '000000',
        data: [{ dataId: 'audit-reject-id', status: 'REJECT' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )

  try {
    const result = await checkContent({
      kind: 'picture',
      content: 'https://example.test/input.jpg',
      contentId: 'audit-reject-test',
      description: 'audit reject regression test',
    })
    assert.equal(result.passed, false)
    assert.equal(result.dataId, 'audit-reject-id')
    assert.equal(isAuditServiceUnavailable(result), false)
  } finally {
    restoreEnv('AUDIT_API_BASE_URL', previous.baseUrl)
    restoreEnv('AUDIT_ACCOUNT', previous.account)
    restoreEnv('AUDIT_APP_KEY', previous.appKey)
    globalThis.fetch = previous.fetch
  }
})

test('times out a stalled audit HTTP request without leaking a rejected callback waiter', async () => {
  const previous = {
    baseUrl: process.env.AUDIT_API_BASE_URL,
    account: process.env.AUDIT_ACCOUNT,
    appKey: process.env.AUDIT_APP_KEY,
    timeout: process.env.AUDIT_TIMEOUT_MS,
    fetch: globalThis.fetch,
  }
  process.env.AUDIT_API_BASE_URL = 'https://audit.example.test'
  process.env.AUDIT_ACCOUNT = 'test-account'
  process.env.AUDIT_APP_KEY = '1234567890abcdef'
  process.env.AUDIT_TIMEOUT_MS = '20'
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })

  try {
    const result = await checkContent({
      kind: 'picture',
      content: 'https://example.test/input.jpg',
      contentId: 'audit-timeout-test',
      description: 'audit timeout regression test',
    })
    assert.equal(result.passed, false)
    assert.equal(isAuditServiceUnavailable(result), true)
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    restoreEnv('AUDIT_API_BASE_URL', previous.baseUrl)
    restoreEnv('AUDIT_ACCOUNT', previous.account)
    restoreEnv('AUDIT_APP_KEY', previous.appKey)
    restoreEnv('AUDIT_TIMEOUT_MS', previous.timeout)
    globalThis.fetch = previous.fetch
  }
})

test('restores a PROCESSING audit from a late callback without submitting it twice', async () => {
  const previous = {
    baseUrl: process.env.AUDIT_API_BASE_URL,
    account: process.env.AUDIT_ACCOUNT,
    appKey: process.env.AUDIT_APP_KEY,
    fetch: globalThis.fetch,
  }
  process.env.AUDIT_API_BASE_URL = 'https://audit.example.test'
  process.env.AUDIT_ACCOUNT = 'test-account'
  process.env.AUDIT_APP_KEY = '1234567890abcdef'
  let fetchCount = 0
  globalThis.fetch = async () => {
    fetchCount += 1
    return new Response(
      JSON.stringify({ code: '000000', data: [{ dataId: 'late-audit-id', status: 'PROCESSING' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    const pending = await checkContent({
      kind: 'picture',
      content: 'https://example.test/late.jpg',
      contentId: 'late-audit-content',
      description: 'late callback regression test',
    })
    assert.equal(pending.pending, true)
    assert.equal(fetchCount, 1)
    assert.equal(handleAuditCallback({ dataId: 'late-audit-id', status: 'NORMAL', label: 'NORMAL' }), 1)

    const completed = await checkContent({
      kind: 'picture',
      content: 'https://example.test/late.jpg',
      contentId: 'late-audit-content',
      description: 'late callback regression test',
    })
    assert.equal(completed.passed, true)
    assert.equal(fetchCount, 1)
  } finally {
    restoreEnv('AUDIT_API_BASE_URL', previous.baseUrl)
    restoreEnv('AUDIT_ACCOUNT', previous.account)
    restoreEnv('AUDIT_APP_KEY', previous.appKey)
    globalThis.fetch = previous.fetch
  }
})

test('classifies provider FAILED as unavailable instead of a content rejection', async () => {
  const previous = {
    baseUrl: process.env.AUDIT_API_BASE_URL,
    account: process.env.AUDIT_ACCOUNT,
    appKey: process.env.AUDIT_APP_KEY,
    fetch: globalThis.fetch,
  }
  process.env.AUDIT_API_BASE_URL = 'https://audit.example.test'
  process.env.AUDIT_ACCOUNT = 'test-account'
  process.env.AUDIT_APP_KEY = '1234567890abcdef'
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ code: '000000', data: [{ dataId: 'failed-audit-id', status: 'FAILED' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  try {
    const result = await checkContent({
      kind: 'picture',
      content: 'https://example.test/failed.jpg',
      contentId: 'failed-audit-content',
      description: 'failed audit regression test',
    })
    assert.equal(result.passed, false)
    assert.equal(isAuditServiceUnavailable(result), true)
  } finally {
    restoreEnv('AUDIT_API_BASE_URL', previous.baseUrl)
    restoreEnv('AUDIT_ACCOUNT', previous.account)
    restoreEnv('AUDIT_APP_KEY', previous.appKey)
    globalThis.fetch = previous.fetch
  }
})

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
