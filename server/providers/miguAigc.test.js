import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTaskIdRedirectUrl, hasUsableTokenEntitlement } from './miguAigc.js'

test('requires a positive entitlement count before requesting taskId', () => {
  assert.equal(hasUsableTokenEntitlement(null), false)
  assert.equal(hasUsableTokenEntitlement({}), false)
  assert.equal(hasUsableTokenEntitlement({ rightsCount: 0, experienceCount: '0', availablePointsCount: -1 }), false)
  assert.equal(hasUsableTokenEntitlement({ rightsCount: '1' }), true)
  assert.equal(hasUsableTokenEntitlement({ experienceCount: 2 }), true)
  assert.equal(hasUsableTokenEntitlement({ availablePointsCount: '3' }), true)
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
