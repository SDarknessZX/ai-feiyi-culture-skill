import assert from 'node:assert/strict'
import express from 'express'
import test from 'node:test'
import { SmsAuthError } from './smsAuth.js'
import { createSmsLoginRouter } from './smsLoginRouter.js'

async function withServer(service, options, run) {
  const app = express()
  app.use(express.json())
  const router = createSmsLoginRouter({ service, ...options })
  app.use('/api/auth/sms', router)
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    await run(baseUrl)
  } finally {
    router.close()
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

async function post(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { response, body: await response.json() }
}

test('exposes send and verify endpoints without returning the phone number', async () => {
  const calls = []
  const service = {
    async sendCode(phone) {
      calls.push(['send', phone])
      return { retryAfterSeconds: 60 }
    },
    async verifyCode(phone, code) {
      calls.push(['verify', phone, code])
      return { url: 'https://login.example.test/one-time' }
    },
  }

  await withServer(service, {}, async (baseUrl) => {
    const sent = await post(baseUrl, '/api/auth/sms/send', { phone: '13800138000' })
    assert.equal(sent.response.status, 200)
    assert.deepEqual(sent.body, { ok: true, retryAfterSeconds: 60 })
    assert.equal(JSON.stringify(sent.body).includes('13800138000'), false)

    const verified = await post(baseUrl, '/api/auth/sms/verify', {
      phone: '13800138000',
      code: '123456',
    })
    assert.equal(verified.response.status, 200)
    assert.deepEqual(verified.body, { url: 'https://login.example.test/one-time' })
    assert.deepEqual(calls, [
      ['send', '13800138000'],
      ['verify', '13800138000', '123456'],
    ])
  })
})

test('validates request bodies before calling the SMS service', async () => {
  let calls = 0
  const service = {
    async sendCode() {
      calls += 1
    },
    async verifyCode() {
      calls += 1
    },
  }

  await withServer(service, {}, async (baseUrl) => {
    const invalidPhone = await post(baseUrl, '/api/auth/sms/send', { phone: '123' })
    assert.equal(invalidPhone.response.status, 400)
    assert.equal(invalidPhone.body.code, 'PHONE_INVALID')

    const invalidCode = await post(baseUrl, '/api/auth/sms/verify', {
      phone: '13800138000',
      code: '12ab',
    })
    assert.equal(invalidCode.response.status, 400)
    assert.equal(invalidCode.body.code, 'SMS_CODE_INVALID')
    assert.equal(calls, 0)
  })
})

test('maps known authentication errors and retry metadata to safe responses', async () => {
  const service = {
    async sendCode() {
      throw new SmsAuthError('SMS_SEND_TOO_FREQUENT', '验证码发送过于频繁，请稍后重试。', {
        status: 429,
        retryAfterSeconds: 37,
      })
    },
    async verifyCode() {
      throw new SmsAuthError('SMS_CODE_INVALID', '验证码错误或已过期。')
    },
  }

  await withServer(service, {}, async (baseUrl) => {
    const sent = await post(baseUrl, '/api/auth/sms/send', { phone: '13800138000' })
    assert.equal(sent.response.status, 429)
    assert.equal(sent.response.headers.get('retry-after'), '37')
    assert.equal(sent.body.code, 'SMS_SEND_TOO_FREQUENT')

    const verified = await post(baseUrl, '/api/auth/sms/verify', {
      phone: '13800138000',
      code: '123456',
    })
    assert.equal(verified.response.status, 400)
    assert.deepEqual(verified.body, {
      code: 'SMS_CODE_INVALID',
      message: '验证码错误或已过期。',
    })
  })
})

test('limits send attempts by resolved client IP before invoking the provider', async () => {
  let calls = 0
  const service = {
    async sendCode() {
      calls += 1
      return { retryAfterSeconds: 60 }
    },
    async verifyCode() {
      return { url: 'https://login.example.test/' }
    },
  }

  await withServer(
    service,
    { sendRateLimit: { windowMs: 10_000, maxRequests: 1 } },
    async (baseUrl) => {
      const first = await post(baseUrl, '/api/auth/sms/send', { phone: '13800138000' })
      assert.equal(first.response.status, 200)

      const limited = await post(baseUrl, '/api/auth/sms/send', { phone: '13900139000' })
      assert.equal(limited.response.status, 429)
      assert.equal(limited.body.code, 'SMS_RATE_LIMITED')
      assert.equal(limited.response.headers.get('retry-after'), '10')
      assert.equal(calls, 1)
    },
  )
})

test('does not expose unexpected provider errors to the client', async () => {
  const service = {
    async sendCode() {
      throw new Error('contains provider internals')
    },
    async verifyCode() {
      throw new Error('contains provider internals')
    },
  }

  await withServer(service, {}, async (baseUrl) => {
    const sent = await post(baseUrl, '/api/auth/sms/send', { phone: '13800138000' })
    assert.equal(sent.response.status, 503)
    assert.deepEqual(sent.body, {
      code: 'SMS_UNAVAILABLE',
      message: '短信登录服务暂时不可用，请稍后重试。',
    })
    assert.equal(JSON.stringify(sent.body).includes('provider internals'), false)
  })
})
