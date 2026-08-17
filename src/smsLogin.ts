export const mainlandPhonePattern = /^1[3-9]\d{9}$/
export const smsCodePattern = /^\d{6}$/

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type ApiErrorPayload = {
  code?: unknown
  message?: unknown
  retryAfterSeconds?: unknown
  url?: unknown
}

export class SmsLoginApiError extends Error {
  code: string
  retryAfterSeconds?: number

  constructor(code: string, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'SmsLoginApiError'
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function isMainlandPhone(value: string) {
  return mainlandPhonePattern.test(value.trim())
}

export function isSmsCode(value: string) {
  return smsCodePattern.test(value.trim())
}

function validateMiguLoginUrl(value: string): string {
  if (value.length === 0 || value.length > 2_048) throw new Error('invalid login URL')
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  const trustedHost = hostname === 'migu.cn' || hostname.endsWith('.migu.cn')
  if (url.protocol !== 'https:' || !trustedHost || url.username || url.password) {
    throw new Error('invalid login URL')
  }
  return url.toString()
}

async function postJson(path: string, body: Record<string, string>, fetcher: Fetcher) {
  let response: Response
  try {
    response = await fetcher(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new SmsLoginApiError('NETWORK_ERROR', '网络连接失败，请稍后重试。')
  }

  let payload: ApiErrorPayload = {}
  try {
    payload = (await response.json()) as ApiErrorPayload
  } catch {
    // A malformed response is handled below without exposing its body.
  }
  if (!response.ok) {
    const retryAfterSeconds = Number(payload.retryAfterSeconds)
    throw new SmsLoginApiError(
      typeof payload.code === 'string' ? payload.code : 'REQUEST_FAILED',
      typeof payload.message === 'string' ? payload.message : '请求失败，请稍后重试。',
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : undefined,
    )
  }
  return payload
}

export async function requestSmsCode(phoneValue: string, fetcher: Fetcher = fetch) {
  const phone = phoneValue.trim()
  if (!isMainlandPhone(phone)) {
    throw new SmsLoginApiError('PHONE_INVALID', '请输入正确的 11 位手机号。')
  }
  const payload = await postJson('/api/auth/sms/send', { phone }, fetcher)
  const retryAfterSeconds = Number(payload.retryAfterSeconds)
  return {
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : 60,
  }
}

export async function verifySmsLogin(phoneValue: string, codeValue: string, fetcher: Fetcher = fetch) {
  const phone = phoneValue.trim()
  const code = codeValue.trim()
  if (!isMainlandPhone(phone)) {
    throw new SmsLoginApiError('PHONE_INVALID', '请输入正确的 11 位手机号。')
  }
  if (!isSmsCode(code)) {
    throw new SmsLoginApiError('SMS_CODE_INVALID', '请输入 6 位验证码。')
  }
  const payload = await postJson('/api/auth/sms/verify', { phone, code }, fetcher)
  if (typeof payload.url !== 'string') {
    throw new SmsLoginApiError('INVALID_RESPONSE', '登录服务响应异常，请重新获取验证码。')
  }
  let url: string
  try {
    url = validateMiguLoginUrl(payload.url)
  } catch {
    throw new SmsLoginApiError('INVALID_RESPONSE', '登录服务响应异常，请重新获取验证码。')
  }
  return { url }
}
