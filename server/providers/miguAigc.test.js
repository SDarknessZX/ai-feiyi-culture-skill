import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPublishRedirectUrl,
  buildTaskIdRedirectUrl,
  hasUsableTokenEntitlement,
  validatePublishMediaUrl,
} from './miguAigc.js'

test('requires a positive entitlement count before requesting taskId', () => {
  assert.equal(hasUsableTokenEntitlement(null), false)
  assert.equal(hasUsableTokenEntitlement({}), false)
  assert.equal(hasUsableTokenEntitlement({ status: 0, rightsCount: 1 }), false)
  assert.equal(hasUsableTokenEntitlement({ status: 1, rightsCount: 0, experienceCount: '0', availablePointsCount: -1 }), false)
  assert.equal(hasUsableTokenEntitlement({ status: 1, rightsCount: '1' }), true)
  assert.equal(hasUsableTokenEntitlement({ status: '1', experienceCount: 2 }), true)
  assert.equal(hasUsableTokenEntitlement({ status: 1, availablePointsCount: '3' }), true)
})

test('builds the documented taskId H5 URL and query parameters', () => {
  const previous = {
    appId: process.env.MIGU_AIGC_APP_ID,
    appSecret: process.env.MIGU_AIGC_APP_SECRET,
    channelCode: process.env.MIGU_CHANNEL_CODE,
    callbackUrl: process.env.MIGU_CALLBACK_URL,
    projectId: process.env.MIGU_PROJECT_ID,
  }
  Object.assign(process.env, {
    MIGU_AIGC_APP_ID: 'ability-id',
    MIGU_AIGC_APP_SECRET: 'secret',
    MIGU_CHANNEL_CODE: 'channel-id',
    MIGU_CALLBACK_URL: 'https://example.com/callback?a=1&b=2',
    MIGU_PROJECT_ID: 'project-id',
  })

  try {
    const result = new URL(buildTaskIdRedirectUrl({ btoken: 'business-token', modelValue: 'model-id', contentType: 'video' }))
    assert.equal(result.origin + result.pathname, 'https://y.migu.cn/app/v5/p/middle/ai-channel-task-id/index.html')
    assert.deepEqual(Object.fromEntries(result.searchParams), {
      appId: 'ability-id',
      schannel: 'channel-id',
      cburl: 'https://example.com/callback?a=1&b=2',
      btoken: 'business-token',
      modelValue: 'model-id',
      projectId: 'project-id',
      contentType: 'video',
    })
  } finally {
    if (previous.appId === undefined) delete process.env.MIGU_AIGC_APP_ID
    else process.env.MIGU_AIGC_APP_ID = previous.appId
    if (previous.appSecret === undefined) delete process.env.MIGU_AIGC_APP_SECRET
    else process.env.MIGU_AIGC_APP_SECRET = previous.appSecret
    if (previous.channelCode === undefined) delete process.env.MIGU_CHANNEL_CODE
    else process.env.MIGU_CHANNEL_CODE = previous.channelCode
    if (previous.callbackUrl === undefined) delete process.env.MIGU_CALLBACK_URL
    else process.env.MIGU_CALLBACK_URL = previous.callbackUrl
    if (previous.projectId === undefined) delete process.env.MIGU_PROJECT_ID
    else process.env.MIGU_PROJECT_ID = previous.projectId
  }
})

test('uses login callback publish parameters and omits optional values when absent', async () => {
  const originalFetch = globalThis.fetch
  const previous = {
    appId: process.env.MIGU_AIGC_APP_ID,
    appSecret: process.env.MIGU_AIGC_APP_SECRET,
    channelCode: process.env.MIGU_CHANNEL_CODE,
    callbackUrl: process.env.MIGU_CALLBACK_URL,
    signKey: process.env.MIGU_CHANNEL_LOGIN_SIGN_KEY,
    loginKey: process.env.MIGU_CHANNEL_LOGIN_KEY,
  }
  Object.assign(process.env, {
    MIGU_AIGC_APP_ID: 'ability-id',
    MIGU_AIGC_APP_SECRET: 'secret',
    MIGU_CHANNEL_CODE: 'channel-id',
    MIGU_CALLBACK_URL: 'https://example.com/callback',
    MIGU_CHANNEL_LOGIN_SIGN_KEY: 'sign-key',
    MIGU_CHANNEL_LOGIN_KEY: 'login-key',
  })
  globalThis.fetch = async () => new Response(JSON.stringify({ token: 'one-time-token' }), { status: 200 })

  try {
    const result = new URL(
      await buildPublishRedirectUrl({
        videoUrl: 'https://cdn.example.com/video.mp4',
        videoCover: 'https://cdn.example.com/cover.jpg',
        projectId: 'callback-project',
        releaseId: 'callback-release',
        watermarkId: 'callback-watermark',
      }),
    )
    assert.equal(result.searchParams.get('projectId'), 'callback-project')
    assert.equal(result.searchParams.get('releaseId'), 'callback-release')
    assert.equal(result.searchParams.get('watermarkId'), 'callback-watermark')
    assert.equal(result.searchParams.get('token'), 'one-time-token')
    assert.equal(result.searchParams.get('tokenType'), 'MGPT')
    assert.equal(result.searchParams.has('otherSet'), false)
    assert.equal(result.searchParams.has('isMiniPublish'), false)
  } finally {
    globalThis.fetch = originalFetch
    const variables = {
      MIGU_AIGC_APP_ID: previous.appId,
      MIGU_AIGC_APP_SECRET: previous.appSecret,
      MIGU_CHANNEL_CODE: previous.channelCode,
      MIGU_CALLBACK_URL: previous.callbackUrl,
      MIGU_CHANNEL_LOGIN_SIGN_KEY: previous.signKey,
      MIGU_CHANNEL_LOGIN_KEY: previous.loginKey,
    }
    for (const [key, value] of Object.entries(variables)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('rejects unsupported or overly long publish media URLs before minting a token', () => {
  const videoExtensions = new Set(['mp4'])
  assert.doesNotThrow(() => validatePublishMediaUrl('https://cdn.example.com/video.mp4', videoExtensions, '视频'))
  assert.throws(
    () => validatePublishMediaUrl('https://cdn.example.com/video', videoExtensions, '视频'),
    /文件后缀/,
  )
  assert.throws(
    () => validatePublishMediaUrl(`https://cdn.example.com/${'a'.repeat(190)}.mp4`, videoExtensions, '视频'),
    /200 个字符/,
  )
})
