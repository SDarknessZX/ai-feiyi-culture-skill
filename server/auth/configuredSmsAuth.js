import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConfiguredAliyunSmsSender } from '../providers/aliyunSms.js'
import { buildLoginRedirectUrlForMsisdn } from '../providers/miguAigc.js'
import { createSmsAuthService, SmsAuthError } from './smsAuth.js'
import { createSmsChallengeStore } from './smsChallengeStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultDatabasePath = path.join(__dirname, '..', 'data', 'sms-login.db')

export function createConfiguredSmsAuthService(env = process.env) {
  const store = createSmsChallengeStore(env.SMS_CHALLENGE_DB_PATH?.trim() || defaultDatabasePath, {
    secret: env.SMS_CHALLENGE_SECRET,
  })
  const service = createSmsAuthService({
    store,
    sender: createConfiguredAliyunSmsSender(env),
    buildLoginUrl: buildLoginRedirectUrlForMsisdn,
  })
  return { service, close: () => store.close() }
}

export function createUnavailableSmsAuthService() {
  const unavailable = async () => {
    throw new SmsAuthError('SMS_UNAVAILABLE', '短信登录服务暂时不可用，请稍后重试。', { status: 503 })
  }
  return { sendCode: unavailable, verifyCode: unavailable }
}
