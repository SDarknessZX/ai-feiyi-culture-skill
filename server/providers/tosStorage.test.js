import assert from 'node:assert/strict'
import test from 'node:test'
import { detectImageType } from './tosStorage.js'

test('detects image content from bytes instead of trusting the upload MIME type', () => {
  assert.deepEqual(detectImageType(Buffer.from([0xff, 0xd8, 0xff, ...Array(9).fill(0)])), {
    extension: '.jpg',
    contentType: 'image/jpeg',
  })
  assert.deepEqual(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), {
    extension: '.png',
    contentType: 'image/png',
  })
  assert.equal(detectImageType(Buffer.from('<script>alert(1)</script>')), null)
})
