import assert from 'node:assert/strict'
import test from 'node:test'
import { checkContent, isAuditServiceUnavailable } from './contentAudit.js'

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

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
