import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

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
  const extension = path.extname(file.originalname || '') || guessExtension(file.mimetype)
  const objectKey = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension}`
  const body = await fs.readFile(file.path)
  return uploadBufferToTos(body, objectKey, file.mimetype || 'application/octet-stream')
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

function guessExtension(mimetype = '') {
  if (mimetype === 'image/png') return '.png'
  if (mimetype === 'image/webp') return '.webp'
  return '.jpg'
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest()
}
