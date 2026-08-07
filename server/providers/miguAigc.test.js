import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import {
  buildLoginRedirectUrl,
  buildPublishRedirectUrl,
  buildTaskIdRedirectUrl,
  cancelTokenTask,
  hasUsableTokenEntitlement,
  reportInteraction,
  reportTokenResult,
  validatePublishMediaUrl,
} from './miguAigc.js'

test('uses the dedicated login key and signature key when minting cToken', async () => {
  const originalFetch = globalThis.fetch
  const names = [
    'MIGU_AIGC_APP_ID',
    'MIGU_AIGC_APP_SECRET',
    'MIGU_CHANNEL_CODE',
    'MIGU_CALLBACK_URL',
    'MIGU_CHANNEL_LOGIN_SIGN_KEY',
    'MIGU_CHANNEL_LOGIN_KEY',
  ]
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  Object.assign(process.env, {
    MIGU_AIGC_APP_ID: 'ability-id',
    MIGU_AIGC_APP_SECRET: 'legacy-secret',
    MIGU_CHANNEL_CODE: 'channel-id',
    MIGU_CALLBACK_URL: 'https://example.com/callback',
    MIGU_CHANNEL_LOGIN_SIGN_KEY: 'dedicated-signature-key',
    MIGU_CHANNEL_LOGIN_KEY: 'dedicated-login-key',
  })

  let loginPayload
  globalThis.fetch = async (requestUrl) => {
    const request = new URL(String(requestUrl))
    loginPayload = JSON.parse(request.searchParams.get('data'))
    return new Response(JSON.stringify({ token: 'one-time-token' }), { status: 200 })
  }

  try {
    const redirect = new URL(await buildLoginRedirectUrl())
    assert.equal(loginPayload.channelCode, 'channel-id')
    assert.equal(loginPayload.key, 'dedicated-login-key')
    assert.equal(
      loginPayload.signature,
      crypto.createHash('md5').update(`channel-id${loginPayload.timestamp}dedicated-signature-key`).digest('hex'),
    )
    assert.equal(redirect.searchParams.get('cToken'), 'one-time-token')
    assert.equal(redirect.searchParams.get('schannel'), 'channel-id')
    assert.equal(redirect.searchParams.get('cburl'), 'https://example.com/callback')
  } finally {
    globalThis.fetch = originalFetch
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
})

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

test('calls cancel, result report, and interaction endpoints with documented payloads', async () => {
  const originalFetch = globalThis.fetch
  const previous = {
    appId: process.env.MIGU_AIGC_APP_ID,
    appSecret: process.env.MIGU_AIGC_APP_SECRET,
    channelCode: process.env.MIGU_CHANNEL_CODE,
    callbackUrl: process.env.MIGU_CALLBACK_URL,
  }
  Object.assign(process.env, {
    MIGU_AIGC_APP_ID: 'ability-id',
    MIGU_AIGC_APP_SECRET: 'secret',
    MIGU_CHANNEL_CODE: 'channel-id',
    MIGU_CALLBACK_URL: 'https://example.com/callback',
  })
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) })
    return new Response(JSON.stringify({ code: '000000', info: '成功', data: {} }), { status: 200 })
  }

  try {
    await cancelTokenTask({ otoken: 'business-token', taskId: 'task-1' })
    await reportTokenResult({
      otoken: 'business-token',
      taskId: 'task-2',
      result: false,
      inputContents: [{ contentType: 'image', content: 'https://cdn.example.com/input.jpg' }],
      mediumResults: [{ contentType: 'image', content: 'https://cdn.example.com/medium.jpg' }],
    })
    await reportInteraction({ otoken: 'business-token', ask: '', ans: '快捷文案', ansBy: 'shortcut' })

    assert.match(calls[0].url, /\/open\/api\/user\/ai-charging\/cancel\/task\/v1\.0$/)
    assert.deepEqual(calls[0].body, { taskId: 'task-1', appId: 'ability-id' })
    assert.match(calls[1].url, /\/open\/api\/user\/ai-charging\/report\/result\/v1\.0$/)
    assert.equal(calls[1].body.result, false)
    assert.deepEqual(calls[1].body.mediumResults, [
      { contentType: 'image', content: 'https://cdn.example.com/medium.jpg' },
    ])
    assert.match(calls[2].url, /\/open\/api\/user\/ai-charging\/report\/interact\/v1\.0$/)
    assert.deepEqual(calls[2].body, { appId: 'ability-id', ask: '', ans: '快捷文案', ansBy: 'shortcut' })
    for (const call of calls) {
      assert.equal(call.headers['x-mgmusic-otoken'], 'business-token')
      assert.ok(call.headers['x-mgmusic-osign'])
    }
  } finally {
    globalThis.fetch = originalFetch
    const variables = {
      MIGU_AIGC_APP_ID: previous.appId,
      MIGU_AIGC_APP_SECRET: previous.appSecret,
      MIGU_CHANNEL_CODE: previous.channelCode,
      MIGU_CALLBACK_URL: previous.callbackUrl,
    }
    for (const [key, value] of Object.entries(variables)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
