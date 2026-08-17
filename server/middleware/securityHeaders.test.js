import assert from 'node:assert/strict'
import test from 'node:test'
import { getSecurityHeaders } from './securityHeaders.js'

test('adds production transport and embedding protections', () => {
  const headers = getSecurityHeaders({ production: true })
  assert.equal(headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(headers['X-Frame-Options'], 'DENY')
  assert.equal(headers['Strict-Transport-Security'], 'max-age=31536000; includeSubDomains')
  assert.equal(headers['Content-Security-Policy'], "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
})

test('does not send HSTS from local development', () => {
  const headers = getSecurityHeaders({ production: false })
  assert.equal(Object.hasOwn(headers, 'Strict-Transport-Security'), false)
})
