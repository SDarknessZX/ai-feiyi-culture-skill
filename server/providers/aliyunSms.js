import Credential from '@alicloud/credentials'
import Dysmsapi20170525, { SendSmsRequest } from '@alicloud/dysmsapi20170525'
import { Config as OpenApiConfig } from '@alicloud/openapi-client'

const aliyunSmsEndpoint = 'dysmsapi.aliyuncs.com'

export class AliyunSmsError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, { cause })
    this.name = 'AliyunSmsError'
    this.code = code
  }
}

function readConfig(env = process.env) {
  return {
    signName: env.ALIYUN_SMS_SIGN_NAME?.trim() || '',
    templateCode: env.ALIYUN_SMS_TEMPLATE_CODE?.trim() || '',
  }
}

export function getAliyunSmsConfigReport(env = process.env) {
  const config = readConfig(env)
  const accessKeyConfigured = Boolean(
    env.ALIBABA_CLOUD_ACCESS_KEY_ID?.trim() && env.ALIBABA_CLOUD_ACCESS_KEY_SECRET?.trim(),
  )
  const signNameConfigured = Boolean(config.signName)
  const templateCodeConfigured = Boolean(config.templateCode)
  const challengeSecretConfigured = Buffer.byteLength(env.SMS_CHALLENGE_SECRET || '', 'utf8') >= 32
  return {
    configured:
      accessKeyConfigured && signNameConfigured && templateCodeConfigured && challengeSecretConfigured,
    accessKeyConfigured,
    signNameConfigured,
    templateCodeConfigured,
    challengeSecretConfigured,
  }
}

export function createAliyunSmsClient() {
  const credential = new Credential()
  const config = new OpenApiConfig({
    credential,
    endpoint: aliyunSmsEndpoint,
  })
  return new Dysmsapi20170525(config)
}

export function createAliyunSmsSender({ client, signName, templateCode } = {}) {
  if (!client || !signName || !templateCode) {
    throw new Error('阿里云短信客户端、签名或模板未配置。')
  }

  return async function sendAliyunSms({ phone, code }) {
    const request = new SendSmsRequest({
      phoneNumbers: phone,
      signName,
      templateCode,
      templateParam: JSON.stringify({ code }),
    })
    let response
    try {
      response = await client.sendSms(request)
    } catch (cause) {
      throw new AliyunSmsError('ALIYUN_SMS_REQUEST_FAILED', '阿里云短信请求失败。', { cause })
    }
    const responseCode = String(response?.body?.code || '')
    if (responseCode !== 'OK') {
      throw new AliyunSmsError(responseCode || 'ALIYUN_SMS_REJECTED', '阿里云短信服务未接受本次发送请求。')
    }
  }
}

export function createConfiguredAliyunSmsSender(env = process.env) {
  const report = getAliyunSmsConfigReport(env)
  if (!report.configured) {
    throw new Error('阿里云短信登录配置不完整。')
  }
  const config = readConfig(env)
  return createAliyunSmsSender({
    client: createAliyunSmsClient(),
    signName: config.signName,
    templateCode: config.templateCode,
  })
}
