import crypto from 'node:crypto'
import fs from 'node:fs/promises'

const requiredKeys = [
  'TOS_ACCESS_KEY_ID',
  'TOS_SECRET_ACCESS_KEY',
  'TOS_REGION',
  'TOS_BUCKET',
  'TOS_PUBLIC_BASE_URL',
]

export function hasTosConfig() {
  return requiredKeys.every((key) => Boolean(process.env[key]))
}

export function getTosConfigReport() {
  return {
    configured: hasTosConfig(),
    bucket: process.env.TOS_BUCKET || '',
    region: process.env.TOS_REGION || '',
    publicBaseUrl: process.env.TOS_PUBLIC_BASE_URL || '',
  }
}

export async function uploadFileToTos(file) {
  const body = await fs.readFile(file.path)
  const detected = detectImageType(body)
  if (!detected) {
    throw new Error('上传内容不是受支持的 JPG、PNG、WebP 或 GIF 图片。')
  }
  const objectKey = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${detected.extension}`
  return uploadBufferToTos(body, objectKey, detected.contentType)
}

export async function uploadBufferToTos(body, objectKey, contentType) {
  if (!hasTosConfig()) {
    throw new Error('TOS 配置不完整。请在 .env 填 TOS_ACCESS_KEY_ID、TOS_SECRET_ACCESS_KEY、TOS_REGION、TOS_BUCKET、TOS_PUBLIC_BASE_URL。')
  }

  const endpoint = getTosEndpoint()
  const url = new URL(`https://${process.env.TOS_BUCKET}.${endpoint}/${objectKey}`)
  const headers = signTosRequest({
    method: 'PUT',
    url,
    body,
    contentType,
  })

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body,
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`TOS 上传失败：HTTP ${response.status} ${detail || response.statusText}`)
  }

  return `${process.env.TOS_PUBLIC_BASE_URL.replace(/\/$/, '')}/${objectKey}`
}

function signTosRequest({ method, url, body, contentType }) {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const region = process.env.TOS_REGION || 'cn-beijing'
  const service = 'tos'
  const payloadHash = sha256(body)
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${url.host}`,
    `x-tos-content-sha256:${payloadHash}`,
    `x-tos-date:${timestamp}`,
  ].join('\n')
  const signedHeaders = 'content-type;host;x-tos-content-sha256;x-tos-date'
  const canonicalRequest = [
    method,
    encodeURI(url.pathname),
    '',
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const credentialScope = `${date}/${region}/${service}/request`
  const stringToSign = [
    'TOS4-HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n')
  const signingKey = hmac(
    hmac(hmac(hmac(process.env.TOS_SECRET_ACCESS_KEY, date), region), service),
    'request',
  )
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return {
    authorization: [
      `TOS4-HMAC-SHA256 Credential=${process.env.TOS_ACCESS_KEY_ID}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', '),
    'content-type': contentType,
    'x-tos-content-sha256': payloadHash,
    'x-tos-date': timestamp,
  }
}

function getTosEndpoint() {
  if (process.env.TOS_ENDPOINT) return process.env.TOS_ENDPOINT.replace(/^https?:\/\//, '')
  const region = process.env.TOS_REGION || 'cn-beijing'
  return `tos-${region}.volces.com`
}

export function detectImageType(body) {
  if (!Buffer.isBuffer(body) || body.length < 12) return null
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return { extension: '.jpg', contentType: 'image/jpeg' }
  }
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: '.png', contentType: 'image/png' }
  }
  if (body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { extension: '.webp', contentType: 'image/webp' }
  }
  if (['GIF87a', 'GIF89a'].includes(body.subarray(0, 6).toString('ascii'))) {
    return { extension: '.gif', contentType: 'image/gif' }
  }
  return null
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest()
}
