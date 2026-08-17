import { Router } from 'express'
import { z } from 'zod'
import { mainlandPhonePattern, smsCodePattern, SmsAuthError } from './smsAuth.js'

const sendSchema = z.object({ phone: z.string().trim().regex(mainlandPhonePattern) }).strict()
const verifySchema = z
  .object({
    phone: z.string().trim().regex(mainlandPhonePattern),
    code: z.string().trim().regex(smsCodePattern),
  })
  .strict()

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function createIpRateLimiter({ windowMs, maxRequests, now = () => Date.now() }) {
  const requestsByClient = new Map()

  function prune(timestamp) {
    for (const [clientKey, timestamps] of requestsByClient) {
      const recent = timestamps.filter((item) => timestamp - item < windowMs)
      if (recent.length) requestsByClient.set(clientKey, recent)
      else requestsByClient.delete(clientKey)
    }
  }

  const timer = setInterval(() => prune(now()), windowMs)
  timer.unref?.()

  function middleware(request, response, next) {
    const timestamp = now()
    const clientKey = request.ip || request.socket?.remoteAddress || 'unknown'
    const recent = (requestsByClient.get(clientKey) || []).filter((item) => timestamp - item < windowMs)
    if (recent.length >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (timestamp - recent[0])) / 1000))
      response.set('Retry-After', String(retryAfterSeconds))
      return response.status(429).json({
        code: 'SMS_RATE_LIMITED',
        retryAfterSeconds,
        message: `请求过于频繁，请在 ${retryAfterSeconds} 秒后重试。`,
      })
    }
    recent.push(timestamp)
    requestsByClient.set(clientKey, recent)
    next()
  }

  middleware.close = () => clearInterval(timer)
  return middleware
}

function sendError(response, error) {
  if (error instanceof SmsAuthError) {
    if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
    return response.status(error.status).json({
      code: error.code,
      message: error.message,
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    })
  }
  return response.status(503).json({
    code: 'SMS_UNAVAILABLE',
    message: '短信登录服务暂时不可用，请稍后重试。',
  })
}

export function createSmsLoginRouter({
  service,
  now = () => Date.now(),
  sendRateLimit = {
    windowMs: positiveNumber(process.env.SMS_SEND_RATE_LIMIT_WINDOW_MS, 10 * 60_000),
    maxRequests: positiveNumber(process.env.SMS_SEND_RATE_LIMIT, 5),
  },
  verifyRateLimit = {
    windowMs: positiveNumber(process.env.SMS_VERIFY_RATE_LIMIT_WINDOW_MS, 10 * 60_000),
    maxRequests: positiveNumber(process.env.SMS_VERIFY_RATE_LIMIT, 10),
  },
} = {}) {
  if (!service) throw new Error('短信登录路由缺少服务实现。')
  const router = Router()
  const sendLimiter = createIpRateLimiter({ ...sendRateLimit, now })
  const verifyLimiter = createIpRateLimiter({ ...verifyRateLimit, now })

  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store')
    next()
  })

  router.post('/send', sendLimiter, async (request, response) => {
    const parsed = sendSchema.safeParse(request.body)
    if (!parsed.success) {
      return response.status(400).json({ code: 'PHONE_INVALID', message: '请输入正确的 11 位手机号。' })
    }
    try {
      const result = await service.sendCode(parsed.data.phone)
      return response.json({ ok: true, retryAfterSeconds: result.retryAfterSeconds })
    } catch (error) {
      return sendError(response, error)
    }
  })

  router.post('/verify', verifyLimiter, async (request, response) => {
    const parsed = verifySchema.safeParse(request.body)
    if (!parsed.success) {
      const phoneValid = mainlandPhonePattern.test(String(request.body?.phone || '').trim())
      return response.status(400).json({
        code: phoneValid ? 'SMS_CODE_INVALID' : 'PHONE_INVALID',
        message: phoneValid ? '验证码错误或已过期。' : '请输入正确的 11 位手机号。',
      })
    }
    try {
      const result = await service.verifyCode(parsed.data.phone, parsed.data.code)
      return response.json({ url: result.url })
    } catch (error) {
      return sendError(response, error)
    }
  })

  router.close = () => {
    sendLimiter.close()
    verifyLimiter.close()
  }
  return router
}
