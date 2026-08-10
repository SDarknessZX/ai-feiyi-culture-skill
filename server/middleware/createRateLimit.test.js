import assert from 'node:assert/strict'
import test from 'node:test'
import { createCreationRateLimiter } from './createRateLimit.js'

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    set(name, value) {
      this.headers[name] = value
      return this
    },
    status(value) {
      this.statusCode = value
      return this
    },
    json(value) {
      this.body = value
      return this
    },
  }
}

test('limits each resolved client IP independently and returns retry metadata', () => {
  let timestamp = 1_000
  const limiter = createCreationRateLimiter({ windowMs: 10_000, maxRequests: 2, now: () => timestamp })
  const call = (ip) => {
    const response = responseRecorder()
    let passed = false
    limiter({ ip }, response, () => {
      passed = true
    })
    return { passed, response }
  }

  try {
    assert.equal(call('203.0.113.1').passed, true)
    assert.equal(call('203.0.113.1').passed, true)
    const limited = call('203.0.113.1')
    assert.equal(limited.passed, false)
    assert.equal(limited.response.statusCode, 429)
    assert.equal(limited.response.body.code, 'CREATE_RATE_LIMITED')
    assert.equal(limited.response.headers['Retry-After'], '10')
    assert.equal(call('203.0.113.2').passed, true)

    timestamp += 10_001
    assert.equal(call('203.0.113.1').passed, true)
  } finally {
    limiter.close()
  }
})
