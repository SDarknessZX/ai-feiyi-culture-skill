import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isMainlandPhone,
  isSmsCode,
  requestSmsCode,
  shouldPromptForSmsLogin,
  SmsLoginApiError,
  verifySmsLogin,
} from './smsLogin.ts'

test('prompts unauthenticated production visitors for SMS login on entry', () => {
  assert.equal(shouldPromptForSmsLogin({ bypassLogin: false, isLoggedIn: false }), true)
  assert.equal(shouldPromptForSmsLogin({ bypassLogin: false, isLoggedIn: true }), false)
  assert.equal(shouldPromptForSmsLogin({ bypassLogin: true, isLoggedIn: false }), false)
})

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

test('validates supported phone and six-digit code formats', () => {
  assert.equal(isMainlandPhone('13800138000'), true)
  assert.equal(isMainlandPhone('12800138000'), false)
  assert.equal(isMainlandPhone('1380013800'), false)
  assert.equal(isSmsCode('123456'), true)
  assert.equal(isSmsCode('12345'), false)
  assert.equal(isSmsCode('12345a'), false)
})

test('requests an SMS code with the normalized phone number', async () => {
  const requests = []
  const result = await requestSmsCode(' 13800138000 ', async (input, init) => {
    requests.push({ url: String(input), init })
    return jsonResponse({ ok: true, retryAfterSeconds: 60 })
  })

  assert.deepEqual(result, { retryAfterSeconds: 60 })
  assert.equal(requests[0].url, '/api/auth/sms/send')
  assert.equal(requests[0].init?.method, 'POST')
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { phone: '13800138000' })
})

test('verifies the code and returns the one-time login URL', async () => {
  const result = await verifySmsLogin('13800138000', ' 123456 ', async (input, init) => {
    assert.equal(String(input), '/api/auth/sms/verify')
    assert.deepEqual(JSON.parse(String(init?.body)), { phone: '13800138000', code: '123456' })
    return jsonResponse({ url: 'https://passport.migu.cn/one-time' })
  })

  assert.deepEqual(result, { url: 'https://passport.migu.cn/one-time' })
})

test('rejects login handoff URLs outside the HTTPS Migu allowlist', async () => {
  for (const url of [
    'https://migu.cn.attacker.example/login',
    'http://passport.migu.cn/login',
    'https://user:pass@passport.migu.cn/login',
    `https://passport.migu.cn/login?ticket=${'x'.repeat(4_100)}`,
  ]) {
    await assert.rejects(
      () => verifySmsLogin('13800138000', '123456', async () => jsonResponse({ url })),
      (error) => error instanceof SmsLoginApiError && error.code === 'INVALID_RESPONSE',
    )
  }
})

test('surfaces safe API messages and retry metadata', async () => {
  await assert.rejects(
    () =>
      requestSmsCode('13800138000', async () =>
        jsonResponse(
          { code: 'SMS_SEND_TOO_FREQUENT', message: '请稍后重试。', retryAfterSeconds: 37 },
          { status: 429 },
        ),
      ),
    (error) => {
      assert.ok(error instanceof SmsLoginApiError)
      assert.equal(error.code, 'SMS_SEND_TOO_FREQUENT')
      assert.equal(error.message, '请稍后重试。')
      assert.equal(error.retryAfterSeconds, 37)
      return true
    },
  )
})

test('uses a generic message for network failures and malformed success responses', async () => {
  await assert.rejects(
    () => requestSmsCode('13800138000', async () => Promise.reject(new Error('network detail'))),
    (error) => error instanceof SmsLoginApiError && error.message === '网络连接失败，请稍后重试。',
  )
  await assert.rejects(
    () => verifySmsLogin('13800138000', '123456', async () => jsonResponse({ ok: true })),
    (error) => error instanceof SmsLoginApiError && error.code === 'INVALID_RESPONSE',
  )
})
