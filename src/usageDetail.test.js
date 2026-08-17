import assert from 'node:assert/strict'
import test from 'node:test'
import {
  requestUsageDetailUrl,
  UsageDetailApiError,
  validateUsageDetailUrl,
} from './usageDetail.ts'

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

test('requests the official usage-detail URL for the current login token', async () => {
  const requests = []
  const result = await requestUsageDetailUrl(' current-btoken ', async (input, init) => {
    requests.push({ url: String(input), init })
    return jsonResponse({
      url: 'https://h5.nf.migu.cn/app/v4/n/ai/use-detail/index.html?notice=1&token=one-time',
    })
  })

  assert.equal(
    result.url,
    'https://h5.nf.migu.cn/app/v4/n/ai/use-detail/index.html?notice=1&token=one-time',
  )
  assert.equal(requests[0].url, '/api/migu/usage-detail-url')
  assert.equal(requests[0].init?.method, 'POST')
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { token: 'current-btoken' })
})

test('accepts only the HTTPS Migu usage-detail page', () => {
  const expected = 'https://h5.nf.migu.cn/app/v4/n/ai/use-detail/index.html?notice=1'
  assert.equal(validateUsageDetailUrl(expected), expected)

  for (const unsafeUrl of [
    'http://h5.nf.migu.cn/app/v4/n/ai/use-detail/index.html',
    'https://evil.example/app/v4/n/ai/use-detail/index.html',
    'https://h5.nf.migu.cn/another-page',
    'https://user:password@h5.nf.migu.cn/app/v4/n/ai/use-detail/index.html',
  ]) {
    assert.throws(
      () => validateUsageDetailUrl(unsafeUrl),
      (error) => error instanceof UsageDetailApiError && error.code === 'INVALID_RESPONSE',
    )
  }
})

test('uses safe messages for missing sessions, provider errors, and malformed responses', async () => {
  await assert.rejects(
    () => requestUsageDetailUrl(''),
    (error) =>
      error instanceof UsageDetailApiError &&
      error.code === 'AUTH_REQUIRED' &&
      error.message === '请先登录后查看使用明细。',
  )

  await assert.rejects(
    () =>
      requestUsageDetailUrl('btoken', async () =>
        jsonResponse({ message: 'provider leaked internal detail' }, { status: 502 }),
      ),
    (error) =>
      error instanceof UsageDetailApiError &&
      error.code === 'USAGE_DETAIL_UNAVAILABLE' &&
      error.message === '暂时无法打开使用明细，请稍后重试。',
  )

  await assert.rejects(
    () => requestUsageDetailUrl('btoken', async () => jsonResponse({ ok: true })),
    (error) => error instanceof UsageDetailApiError && error.code === 'INVALID_RESPONSE',
  )
})
