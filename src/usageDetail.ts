const usageDetailOrigin = 'https://h5.nf.migu.cn'
const usageDetailPath = '/app/v4/n/ai/use-detail/index.html'

type FetchLike = typeof fetch

type UsageDetailResponse = {
  url?: unknown
}

export class UsageDetailApiError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'UsageDetailApiError'
    this.code = code
  }
}

export function validateUsageDetailUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new UsageDetailApiError('INVALID_RESPONSE', '使用明细服务返回了无效地址。')
  }

  if (
    url.origin !== usageDetailOrigin ||
    url.pathname !== usageDetailPath ||
    url.username ||
    url.password ||
    value.length > 4096
  ) {
    throw new UsageDetailApiError('INVALID_RESPONSE', '使用明细服务返回了无效地址。')
  }

  return url.toString()
}

export async function requestUsageDetailUrl(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ url: string }> {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    throw new UsageDetailApiError('AUTH_REQUIRED', '请先登录后查看使用明细。')
  }

  let response: Response
  try {
    response = await fetchImpl('/api/migu/usage-detail-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: normalizedToken }),
      cache: 'no-store',
    })
  } catch {
    throw new UsageDetailApiError('NETWORK_ERROR', '网络连接失败，请稍后重试。')
  }

  let data: UsageDetailResponse
  try {
    data = (await response.json()) as UsageDetailResponse
  } catch {
    throw new UsageDetailApiError('INVALID_RESPONSE', '使用明细服务返回了无效响应。')
  }

  if (!response.ok) {
    throw new UsageDetailApiError('USAGE_DETAIL_UNAVAILABLE', '暂时无法打开使用明细，请稍后重试。')
  }
  if (typeof data.url !== 'string') {
    throw new UsageDetailApiError('INVALID_RESPONSE', '使用明细服务返回了无效响应。')
  }

  return { url: validateUsageDetailUrl(data.url) }
}
