import crypto from 'node:crypto'
import { auditStore } from './auditStore.js'

// MIGU 统一审核平台 · 数据送审接口
// 参考文档：《统一审核能力接入说明文档（外部-202607版）》
const REPORT_PATH = '/audit/api/report/v1.0'

const KIND_TO_TYPE = {
  text: 'text',
  picture: 'picture',
  video: 'video',
}

// 各内容类型在咪咕后台绑定的业务 dataType（决定命中哪条审核策略）
const KIND_TO_DATA_TYPE = {
  text: 'ASCFFYWHText',
  picture: 'ASCFFYWHPicture',
  video: 'ASCFFYWHVideo',
}

// 文本审核结果直接同步返回在 status 字段里；图片/视频要等 status=SUCCESS 后看 label 字段
const FINAL_TEXT_STATUSES = new Set(['REJECT', 'NORMAL', 'REVIEW'])
const FINAL_MEDIA_STATUSES = new Set(['SUCCESS', 'REJECT', 'NORMAL', 'REVIEW', 'FAILED'])

function getConfig() {
  return {
    baseUrl: (process.env.AUDIT_API_BASE_URL || '').trim().replace(/\/$/, ''),
    account: process.env.AUDIT_ACCOUNT?.trim() || '',
    appKey: process.env.AUDIT_APP_KEY?.trim() || '',
    callbackName: process.env.AUDIT_CALLBACK_NAME?.trim() || '',
    timeoutMs: positiveNumber(process.env.AUDIT_TIMEOUT_MS, 90_000),
    // 机审服务本身请求失败/超时（不是"审核不通过"）时是否放行，默认不放行更保守
    failOpenOnError: process.env.AUDIT_FAIL_OPEN_ON_ERROR === 'true',
  }
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function isContentAuditConfigured() {
  const { baseUrl, account, appKey } = getConfig()
  return Boolean(baseUrl && account && appKey)
}

export function getContentAuditConfigReport() {
  const { baseUrl, account, callbackName, failOpenOnError, timeoutMs } = getConfig()
  return {
    configured: isContentAuditConfigured(),
    baseUrlConfigured: Boolean(baseUrl),
    account: account || null,
    callbackNameConfigured: Boolean(callbackName),
    failOpenOnError,
    timeoutMs,
  }
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

// Authorization: authv1-account-timestamp-signature，signature = md5Hex(account+appKey+timestamp)
function buildAuthorization({ account, appKey }) {
  const timestamp = formatTimestamp(new Date())
  const signature = crypto.createHash('md5').update(`${account}${appKey}${timestamp}`).digest('hex')
  return `authv1-${account}-${timestamp}-${signature}`
}

// 官方 AuditAesEncryptUtils 附件规定 AES/CBC/PKCS5Padding，固定 IV 为
// m5iNL1GeLYpcokH9；密钥取 appKey 的 UTF-8 原始字节，输出无换行 Base64。
// Node 的 PKCS#7 对 AES 的 16 字节分组与 Java PKCS5Padding 输出一致。
export function encryptAuditUrl(url) {
  const { appKey } = getConfig()
  const key = Buffer.from(appKey, 'utf8')
  if (key.length !== 16) {
    throw new Error(`机审 appKey 必须是 16 字节，当前为 ${key.length} 字节。`)
  }
  const iv = Buffer.from('m5iNL1GeLYpcokH9', 'utf8')
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv)
  return Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]).toString('base64')
}

// 回调结果直接写入 SQLite；不依赖当前进程中存在等待 Promise，服务重启后也能恢复。
export function handleAuditCallback(payload) {
  const results = Array.isArray(payload) ? payload : payload ? [payload] : []
  let matched = 0
  for (const result of results) {
    if (!result?.dataId) continue
    if (!auditStore.findByDataId(result.dataId)) continue
    auditStore.saveResult(result)
    matched += 1
  }
  return matched
}

function normalizeAuditResult(result) {
  const providerFailed = result.status === 'FAILED' || result.label === 'FAILED'
  const label = providerFailed
    ? 'FAILED'
    : FINAL_TEXT_STATUSES.has(result.status)
      ? result.status
      : result.label || result.status
  if (providerFailed) {
    return {
      passed: false,
      skipped: true,
      label,
      dataId: result.dataId,
      error: '审核平台处理失败，请稍后重试。',
      raw: result,
    }
  }
  return {
    passed: label === 'NORMAL',
    label: label || 'UNKNOWN',
    dataId: result.dataId,
    raw: result,
  }
}

export function classifyStoredAudit(audit) {
  if (!audit) return { state: 'pending', label: 'PROCESSING' }
  const label = audit.status === 'FAILED' || audit.label === 'FAILED' ? 'FAILED' : audit.label || audit.status || 'PROCESSING'
  if (label === 'NORMAL') return { state: 'passed', label }
  if (label === 'FAILED') return { state: 'unavailable', label }
  if (label === 'REJECT' || label === 'REVIEW') return { state: 'rejected', label }
  return { state: 'pending', label }
}

function isFinalResult(kind, result) {
  if (kind === 'text') return FINAL_TEXT_STATUSES.has(result.status)
  return FINAL_MEDIA_STATUSES.has(result.status)
}

/**
 * 提交一条内容送审，text 类型同步返回结果；picture/video 类型若接口未同步返回终态，
 * 会挂起等待 /api/compliance/callback 回调，超时后 reject。
 * kind: 'text' | 'picture' | 'video'
 * content: 文本内容，或图片/视频的可公网访问 URL（会做 AES 加密后再发送）
 */
export async function auditContent({ kind, content, contentId, description }) {
  const config = getConfig()
  if (!isContentAuditConfigured()) {
    throw new Error('机审服务未配置完整（AUDIT_API_BASE_URL / AUDIT_ACCOUNT / AUDIT_APP_KEY），请检查 .env。')
  }
  const type = KIND_TO_TYPE[kind]
  const dataType = KIND_TO_DATA_TYPE[kind]
  if (!type || !dataType) {
    throw new Error(`不支持的机审内容类型：${kind}`)
  }

  const auditContentId = contentId || crypto.randomUUID()
  const stored = auditStore.findRecent(kind, auditContentId, Date.now() - 30 * 60 * 1000)
  if (stored && isFinalResult(kind, stored)) return normalizeAuditResult(stored)
  if (stored) {
    return { passed: false, pending: true, label: stored.label || stored.status || 'PROCESSING', dataId: stored.dataId }
  }
  const dataId = stored?.dataId || crypto.randomUUID()
  const dataValue = kind === 'text' ? content : encryptAuditUrl(content)

  const body = {
    type,
    account: config.account,
    contentId: auditContentId,
    sources: [
      {
        dataId,
        data: dataValue,
        dataType,
        description: description || '',
      },
    ],
  }
  if (kind !== 'text' && config.callbackName) {
    body.notifyName = config.callbackName
  }

  auditStore.saveSubmission({ dataId, kind, contentId: auditContentId })

  let response
  const requestController = new AbortController()
  const requestTimeout = setTimeout(() => requestController.abort(), config.timeoutMs)
  try {
    response = await fetch(`${config.baseUrl}${REPORT_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildAuthorization(config),
      },
      body: JSON.stringify(body),
      signal: requestController.signal,
    })
  } catch (error) {
    auditStore.remove(dataId)
    const wrapped = new Error(`机审接口请求失败：${error instanceof Error ? error.message : String(error)}`)
    throw wrapped
  } finally {
    clearTimeout(requestTimeout)
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const error = new Error(`机审接口请求失败：HTTP ${response.status} ${detail}`.trim())
    auditStore.remove(dataId)
    throw error
  }

  const payload = await response.json().catch(() => null)
  if (!payload || payload.code !== '000000') {
    const detail = payload?.info || '机审接口返回了未知错误。'
    const error = new Error(`${detail}（code=${payload?.code || 'UNKNOWN'}）`)
    auditStore.remove(dataId)
    throw error
  }

  const [result] = payload.data || []
  if (!result) {
    const error = new Error('机审接口未返回审核结果。')
    auditStore.remove(dataId)
    throw error
  }

  const callbackResult = auditStore.findByDataId(result.dataId || dataId)
  if (callbackResult && isFinalResult(kind, callbackResult)) return normalizeAuditResult(callbackResult)
  auditStore.saveSubmission({
    dataId: result.dataId || dataId,
    kind,
    contentId: auditContentId,
    status: result.status || 'PROCESSING',
    label: result.label || '',
  })

  console.info(
    '[contentAudit] 送审已受理',
    JSON.stringify({ kind, contentId: body.contentId, dataId: result.dataId || dataId, status: result.status || 'PENDING' }),
  )

  if (kind === 'text' || isFinalResult(kind, result)) {
    return normalizeAuditResult(result)
  }

  return {
    passed: false,
    pending: true,
    label: result.label || result.status || 'PROCESSING',
    dataId: result.dataId || dataId,
  }
}

/**
 * checkContent 是业务代码应该调用的入口：统一处理"未配置"和"接口异常"两种情况，
 * 避免机审服务本身的问题直接把创作功能整个打挂。
 * - 未配置（比如 AUDIT_API_BASE_URL 还没填）：放行并打印 warn。
 * - 请求异常：按 AUDIT_FAIL_OPEN_ON_ERROR 决定放行还是拦截，默认拦截（更保守）。
 */
export async function checkContent({ kind, content, contentId, description }) {
  if (!isContentAuditConfigured()) {
    console.warn('[contentAudit] 机审未配置完整，本次跳过审核（AUDIT_API_BASE_URL / AUDIT_ACCOUNT / AUDIT_APP_KEY）。')
    return { passed: true, skipped: true, label: 'SKIPPED_NOT_CONFIGURED' }
  }
  try {
    return await auditContent({ kind, content, contentId, description })
  } catch (error) {
    const { failOpenOnError } = getConfig()
    console.error('[contentAudit] 机审调用失败：', error)
    return {
      passed: failOpenOnError,
      skipped: true,
      label: failOpenOnError ? 'ERROR_FAIL_OPEN' : 'ERROR_FAIL_CLOSED',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function isAuditServiceUnavailable(result) {
  return Boolean(!result?.pending && result?.skipped && result?.error)
}
