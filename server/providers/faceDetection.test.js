import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { detectFaces } from './faceDetection.js'

test('detectFaces normalizes endpoint boxes and caches the same image', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'face-detect-test-'))
  const imagePath = path.join(tempRoot, 'face.png')
  const originalFetch = globalThis.fetch
  const originalEndpoint = process.env.FACE_DETECT_ENDPOINT
  let requestCount = 0

  try {
    await writeFile(imagePath, Buffer.from('test-face-image'))
    process.env.FACE_DETECT_ENDPOINT = 'https://face-detect.example.test'
    globalThis.fetch = async () => {
      requestCount += 1
      return new Response(
        JSON.stringify({
          face_bounding_boxes: [[99.2, 36, 166, 116]],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }

    const file = {
      path: imagePath,
      mimetype: 'image/png',
      originalname: 'face.png',
    }
    const first = await detectFaces(file)
    const second = await detectFaces(file)

    assert.equal(first.hasFace, true)
    assert.deepEqual(first.faceBoundingBoxes, [[99, 36, 166, 116]])
    assert.equal(first.cached, false)
    assert.equal(second.cached, true)
    assert.equal(requestCount, 1)
  } finally {
    globalThis.fetch = originalFetch
    if (originalEndpoint === undefined) delete process.env.FACE_DETECT_ENDPOINT
    else process.env.FACE_DETECT_ENDPOINT = originalEndpoint
    await rm(tempRoot, { recursive: true, force: true })
  }
})
