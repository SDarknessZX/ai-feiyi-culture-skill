import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createSafeJsonErrorHandler } from './safeJsonErrors.js'

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const address = server.address()
  try {
    return await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

test('returns a generic malformed-JSON error without logging the request body', async () => {
  const logs = []
  const app = express()
  app.use((request, response, next) => {
    request.requestId = 'request-123'
    next()
  })
  app.use(express.json())
  app.post('/api/auth/sms/verify', (_request, response) => response.json({ ok: true }))
  app.use(createSafeJsonErrorHandler({ logger: (...args) => logs.push(args.join(' ')) }))

  await withServer(app, async (origin) => {
    const sensitiveBody = '{"phone":"13800138000","code":"654321"'
    const response = await fetch(`${origin}/api/auth/sms/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: sensitiveBody,
    })
    const payload = await response.json()

    assert.equal(response.status, 400)
    assert.equal(payload.code, 'INVALID_JSON')
    assert.equal(payload.requestId, 'request-123')
    assert.equal(JSON.stringify(payload).includes('13800138000'), false)
    assert.equal(JSON.stringify(payload).includes('654321'), false)
    assert.equal(logs.join('\n').includes('13800138000'), false)
    assert.equal(logs.join('\n').includes('654321'), false)
  })
})
