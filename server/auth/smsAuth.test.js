import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createSmsAuthService, SmsAuthError } from './smsAuth.js'
import { createSmsChallengeStore } from './smsChallengeStore.js'

const testSecret = 'test-only-sms-challenge-secret-32-bytes'
const validPhone = '13800138000'

function createFixture(options = {}) {
  let timestamp = 1_000
  const sentMessages = []
  const loginPhones = []
  const store = createSmsChallengeStore(':memory:', {
    secret: testSecret,
  })
  const service = createSmsAuthService({
    store,
    now: () => timestamp,
    sender: async (message) => {
      sentMessages.push(message)
    },
    buildLoginUrl: async (phone) => {
      loginPhones.push(phone)
      return `https://login.example.test/?phone=${phone}`
    },
    ...options,
  })
  return {
    service,
    sentMessages,
    loginPhones,
    setNow(value) {
      timestamp = value
    },
    close() {
      store.close()
    },
  }
}

test('sends a six-digit code and enforces the per-phone resend cooldown', async () => {
  const fixture = createFixture()
  try {
    const result = await fixture.service.sendCode(validPhone)
    assert.equal(result.retryAfterSeconds, 60)
    assert.equal(fixture.sentMessages.length, 1)
    assert.equal(fixture.sentMessages[0].phone, validPhone)
    assert.match(fixture.sentMessages[0].code, /^\d{6}$/)
    assert.equal(fixture.sentMessages[0].expiresInMinutes, 5)

    await assert.rejects(() => fixture.service.sendCode(validPhone), (error) => {
      assert.ok(error instanceof SmsAuthError)
      assert.equal(error.code, 'SMS_SEND_TOO_FREQUENT')
      assert.equal(error.retryAfterSeconds, 60)
      return true
    })
    assert.equal(fixture.sentMessages.length, 1)
  } finally {
    fixture.close()
  }
})

test('accepts the correct code once and builds the login URL for that phone', async () => {
  const fixture = createFixture()
  try {
    await fixture.service.sendCode(validPhone)
    const code = fixture.sentMessages[0].code
    const result = await fixture.service.verifyCode(validPhone, code)

    assert.equal(result.url, `https://login.example.test/?phone=${validPhone}`)
    assert.deepEqual(fixture.loginPhones, [validPhone])

    await assert.rejects(() => fixture.service.verifyCode(validPhone, code), (error) => {
      assert.ok(error instanceof SmsAuthError)
      assert.equal(error.code, 'SMS_CODE_INVALID')
      return true
    })
    assert.deepEqual(fixture.loginPhones, [validPhone])
  } finally {
    fixture.close()
  }
})

test('limits incorrect verification attempts without calling the login provider', async () => {
  const fixture = createFixture()
  try {
    await fixture.service.sendCode(validPhone)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(() => fixture.service.verifyCode(validPhone, '000000'), (error) => {
        assert.ok(error instanceof SmsAuthError)
        assert.equal(error.code, 'SMS_CODE_INVALID')
        return true
      })
    }
    const correctCode = fixture.sentMessages[0].code
    await assert.rejects(() => fixture.service.verifyCode(validPhone, correctCode), (error) => {
      assert.ok(error instanceof SmsAuthError)
      assert.equal(error.code, 'SMS_CODE_INVALID')
      return true
    })
    assert.deepEqual(fixture.loginPhones, [])
  } finally {
    fixture.close()
  }
})

test('expires codes after five minutes and allows a new send after cooldown', async () => {
  const fixture = createFixture()
  try {
    await fixture.service.sendCode(validPhone)
    const firstCode = fixture.sentMessages[0].code

    fixture.setNow(61_001)
    await fixture.service.sendCode(validPhone)
    assert.equal(fixture.sentMessages.length, 2)

    fixture.setNow(361_002)
    await assert.rejects(() => fixture.service.verifyCode(validPhone, firstCode), (error) => {
      assert.ok(error instanceof SmsAuthError)
      assert.equal(error.code, 'SMS_CODE_INVALID')
      return true
    })
  } finally {
    fixture.close()
  }
})

test('never writes the plaintext phone number or code to the challenge database', async () => {
  const dbPath = path.join(tmpdir(), `sms-auth-${crypto.randomUUID()}.db`)
  const sentMessages = []
  const store = createSmsChallengeStore(dbPath, { secret: testSecret })
  const service = createSmsAuthService({
    store,
    sender: async (message) => sentMessages.push(message),
    buildLoginUrl: async () => 'https://login.example.test/',
  })

  try {
    await service.sendCode(validPhone)
    store.close()
    const databaseBytes = await readFile(dbPath)
    const databaseText = databaseBytes.toString('utf8')
    assert.equal(databaseText.includes(validPhone), false)
    assert.equal(databaseText.includes(sentMessages[0].code), false)
  } finally {
    try {
      store.close()
    } catch {
      // The test closes the store before reading the file.
    }
    await rm(dbPath, { force: true })
    await rm(`${dbPath}-shm`, { force: true })
    await rm(`${dbPath}-wal`, { force: true })
  }
})

test('rejects malformed phone numbers and verification codes at the service boundary', async () => {
  const fixture = createFixture()
  try {
    await assert.rejects(() => fixture.service.sendCode('1780000'), (error) => {
      assert.ok(error instanceof SmsAuthError)
      assert.equal(error.code, 'PHONE_INVALID')
      return true
    })
    await assert.rejects(() => fixture.service.verifyCode(validPhone, '12ab'), (error) => {
      assert.ok(error instanceof SmsAuthError)
      assert.equal(error.code, 'SMS_CODE_INVALID')
      return true
    })
  } finally {
    fixture.close()
  }
})
