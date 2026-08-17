import assert from 'node:assert/strict'
import test from 'node:test'
import { createAliyunSmsSender, getAliyunSmsConfigReport } from './aliyunSms.js'

test('sends a verification code with the configured Aliyun sign and template', async () => {
  const requests = []
  const sender = createAliyunSmsSender({
    client: {
      async sendSms(request) {
        requests.push(request)
        return { body: { code: 'OK', bizId: 'test-biz-id' } }
      },
    },
    signName: '测试签名',
    templateCode: 'SMS_123456789',
  })

  await sender({ phone: '13800138000', code: '381904', expiresInMinutes: 5 })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].phoneNumbers, '13800138000')
  assert.equal(requests[0].signName, '测试签名')
  assert.equal(requests[0].templateCode, 'SMS_123456789')
  assert.deepEqual(JSON.parse(requests[0].templateParam), { code: '381904' })
})

test('treats non-OK Aliyun responses as send failures', async () => {
  const sender = createAliyunSmsSender({
    client: {
      async sendSms() {
        return { body: { code: 'isv.BUSINESS_LIMIT_CONTROL', message: 'limited' } }
      },
    },
    signName: '测试签名',
    templateCode: 'SMS_123456789',
  })

  await assert.rejects(
    () => sender({ phone: '13800138000', code: '381904', expiresInMinutes: 5 }),
    (error) => error.code === 'isv.BUSINESS_LIMIT_CONTROL' && !error.message.includes('13800138000'),
  )
})

test('configuration report exposes readiness without returning credentials', () => {
  const report = getAliyunSmsConfigReport({
    ALIBABA_CLOUD_ACCESS_KEY_ID: 'access-id',
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'access-secret',
    ALIYUN_SMS_SIGN_NAME: '测试签名',
    ALIYUN_SMS_TEMPLATE_CODE: 'SMS_123456789',
    SMS_CHALLENGE_SECRET: 'x'.repeat(32),
  })

  assert.deepEqual(report, {
    configured: true,
    accessKeyConfigured: true,
    signNameConfigured: true,
    templateCodeConfigured: true,
    challengeSecretConfigured: true,
  })
  assert.equal(JSON.stringify(report).includes('access-id'), false)
  assert.equal(JSON.stringify(report).includes('access-secret'), false)
})
