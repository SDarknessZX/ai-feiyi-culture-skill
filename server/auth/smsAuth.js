import crypto from 'node:crypto'

export const mainlandPhonePattern = /^1[3-9]\d{9}$/
export const smsCodePattern = /^\d{6}$/

export class SmsAuthError extends Error {
  constructor(code, message, { status = 400, retryAfterSeconds, cause } = {}) {
    super(message, { cause })
    this.name = 'SmsAuthError'
    this.code = code
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function createSmsAuthService({
  store,
  sender,
  buildLoginUrl,
  now = () => Date.now(),
  cooldownMs = 60_000,
  codeTtlMs = 5 * 60_000,
  maxAttempts = 5,
} = {}) {
  if (!store || typeof sender !== 'function' || typeof buildLoginUrl !== 'function') {
    throw new Error('短信登录服务依赖未配置完整。')
  }

  return {
    async sendCode(phoneValue) {
      const phone = String(phoneValue || '').trim()
      if (!mainlandPhonePattern.test(phone)) {
        throw new SmsAuthError('PHONE_INVALID', '请输入正确的 11 位手机号。')
      }

      const timestamp = now()
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
      const reservation = store.reserve({
        phone,
        code,
        sentAt: timestamp,
        expiresAt: timestamp + codeTtlMs,
        cooldownMs,
      })
      if (!reservation.accepted) {
        throw new SmsAuthError('SMS_SEND_TOO_FREQUENT', '验证码发送过于频繁，请稍后重试。', {
          status: 429,
          retryAfterSeconds: reservation.retryAfterSeconds,
        })
      }

      try {
        await sender({
          phone,
          code,
          expiresInMinutes: Math.ceil(codeTtlMs / 60_000),
        })
      } catch (cause) {
        store.remove(phone)
        throw new SmsAuthError('SMS_SEND_FAILED', '验证码暂时无法发送，请稍后重试。', {
          status: 503,
          cause,
        })
      }

      return { retryAfterSeconds: reservation.retryAfterSeconds }
    },

    async verifyCode(phoneValue, codeValue) {
      const phone = String(phoneValue || '').trim()
      const code = String(codeValue || '').trim()
      if (!mainlandPhonePattern.test(phone)) {
        throw new SmsAuthError('PHONE_INVALID', '请输入正确的 11 位手机号。')
      }
      if (!smsCodePattern.test(code)) {
        throw new SmsAuthError('SMS_CODE_INVALID', '验证码错误或已过期。')
      }

      const verified = store.consume({ phone, code, now: now(), maxAttempts })
      if (!verified) {
        throw new SmsAuthError('SMS_CODE_INVALID', '验证码错误或已过期。')
      }

      try {
        return { url: await buildLoginUrl(phone) }
      } catch (cause) {
        throw new SmsAuthError('LOGIN_HANDOFF_FAILED', '登录服务暂时不可用，请重新获取验证码后再试。', {
          status: 502,
          cause,
        })
      }
    },
  }
}
