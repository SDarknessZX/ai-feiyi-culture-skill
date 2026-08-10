const defaultWindowMs = 10 * 60 * 1000
const defaultMaxRequests = 20

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function createCreationRateLimiter({
  windowMs = positiveNumber(process.env.CREATE_RATE_LIMIT_WINDOW_MS, defaultWindowMs),
  maxRequests = positiveNumber(process.env.CREATE_RATE_LIMIT, defaultMaxRequests),
  now = () => Date.now(),
} = {}) {
  const requestsByClient = new Map()

  function pruneExpired(timestamp) {
    for (const [clientKey, timestamps] of requestsByClient) {
      const recent = timestamps.filter((item) => timestamp - item < windowMs)
      if (recent.length) requestsByClient.set(clientKey, recent)
      else requestsByClient.delete(clientKey)
    }
  }

  const pruneTimer = setInterval(() => pruneExpired(now()), windowMs)
  pruneTimer.unref?.()

  function middleware(request, response, next) {
    const timestamp = now()
    const clientKey = request.ip || request.socket?.remoteAddress || 'unknown'
    const recent = (requestsByClient.get(clientKey) || []).filter((item) => timestamp - item < windowMs)

    if (recent.length >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (timestamp - recent[0])) / 1000))
      response.set('Retry-After', String(retryAfterSeconds))
      return response.status(429).json({
        status: 'failed',
        code: 'CREATE_RATE_LIMITED',
        retryAfterSeconds,
        message: `创作请求过于频繁，请在 ${retryAfterSeconds} 秒后重试。`,
      })
    }

    recent.push(timestamp)
    requestsByClient.set(clientKey, recent)
    next()
  }

  middleware.close = () => clearInterval(pruneTimer)
  middleware.pruneExpired = pruneExpired
  return middleware
}

export function getTrustProxyHops() {
  const fallback = process.env.NODE_ENV === 'production' ? 1 : 0
  const parsed = Number(process.env.TRUST_PROXY_HOPS ?? fallback)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}
