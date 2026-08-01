import crypto from 'node:crypto'

// 咪咕音乐 AIGC 自发展开放接入（Token计费版）+《数智人和AI视频彩铃包月》服务端安全接口
// SKILL：非遗文化
const LOGIN_PAGE_BASE = 'https://y.migu.cn/app/v5/p/middle/ai-channel-token/index.html'
const TASK_ID_PAGE_BASE = 'https://y.migu.cn/app/v5/p/middle/ai-channel-task-id/index.html'
const PUBLISH_PAGE_BASE = 'https://y.migu.cn/app/v5/p/publish-mid/index.html'
const USAGE_DETAIL_PAGE_BASE = 'https://h5.nf.migu.cn/app/v4/n/ai/use-detail/index.html'
// Token 计费服务端接口地址：文档给的是 IP+端口，没有域名。
// 测试环境端口是 31011，线网环境端口是 31010 —— 这里默认线网，测试环境请用 MIGU_TOKEN_API_BASE_URL 覆盖成 :31011
const API_BASE_URL = (process.env.MIGU_TOKEN_API_BASE_URL?.trim() || 'http://218.200.229.108:31010').replace(/\/$/, '')
// 《数智人和AI视频彩铃包月》接口说明文档给的域名，跟上面 Token 计费接口不是同一组、不是同一个签名规则
const CHANNEL_LOGIN_BASE_URL = (process.env.MIGU_CHANNEL_LOGIN_BASE_URL?.trim() || 'https://hz.migu.cn').replace(/\/$/, '')
const CHANNEL_LOGIN_PATH = '/order/rest/crbt/centrality/secret/url.do'

function getConfig() {
  return {
    appId: process.env.MIGU_AIGC_APP_ID?.trim() || '',
    appSecret: process.env.MIGU_AIGC_APP_SECRET?.trim() || '',
    channelCode: process.env.MIGU_CHANNEL_CODE?.trim() || '',
    projectId: process.env.MIGU_PROJECT_ID?.trim() || '',
    releaseId: process.env.MIGU_RELEASE_ID?.trim() || '',
    watermarkId: process.env.MIGU_WATERMARK_ID?.trim() || '',
    callbackUrl: process.env.MIGU_CALLBACK_URL?.trim() || '',
  }
}

export function isMiguAigcConfigured() {
  const config = getConfig()
  return Boolean(config.appId && config.appSecret && config.channelCode && config.callbackUrl)
}

// 咪咕还没把我们服务器的公网 IP 加白名单之前，Token 计费接口打不通——默认关着，
// 不然创作功能会被一个联不通的接口卡死。白名单开通后把 .env 里的这个改成 true 即可。
export function isTokenGatingEnabled() {
  return process.env.MIGU_TOKEN_GATING_ENABLED === 'true' && isMiguAigcConfigured() && isChannelLoginConfigured()
}

const MODEL_VALUE_BY_MODE = {
  costume: () => process.env.MIGU_MODEL_VALUE_COSTUME?.trim() || '',
  food: () => process.env.MIGU_MODEL_VALUE_FOOD?.trim() || '',
  painting: () => process.env.MIGU_MODEL_VALUE_PAINTING?.trim() || '',
}

export function getModelValueForMode(mode) {
  return MODEL_VALUE_BY_MODE[mode]?.() || ''
}

export function getMiguAigcConfigReport() {
  const config = getConfig()
  return {
    configured: isMiguAigcConfigured(),
    appId: config.appId || null,
    channelCode: config.channelCode || null,
    projectId: config.projectId || null,
    releaseIdConfigured: Boolean(config.releaseId),
    watermarkIdConfigured: Boolean(config.watermarkId),
    callbackUrlConfigured: Boolean(config.callbackUrl),
    channelLoginConfigured: isChannelLoginConfigured(),
    tokenGatingEnabled: isTokenGatingEnabled(),
  }
}

function assertConfigured() {
  if (!isMiguAigcConfigured()) {
    throw new Error(
      '咪咕 AIGC 接入未配置完整（MIGU_AIGC_APP_ID / MIGU_AIGC_APP_SECRET / MIGU_CHANNEL_CODE / MIGU_CALLBACK_URL），请检查 .env。',
    )
  }
}

function formatDateTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

function getChannelLoginConfig() {
  // SKILL 凭证目前只发了一个 appSecret，文档里登陆接口自己的"签名密钥"/"免鉴权登录秘钥"
  // 没给独立的值——默认两个都复用 appSecret，如果联调发现签名对不上，说明咪咕确实分配了
  // 独立密钥，到时候单独在 .env 里配 MIGU_CHANNEL_LOGIN_SIGN_KEY / MIGU_CHANNEL_LOGIN_KEY 覆盖即可
  const appSecret = process.env.MIGU_AIGC_APP_SECRET?.trim() || ''
  return {
    channelCode: process.env.MIGU_CHANNEL_CODE?.trim() || '',
    signKey: process.env.MIGU_CHANNEL_LOGIN_SIGN_KEY?.trim() || appSecret,
    loginKey: process.env.MIGU_CHANNEL_LOGIN_KEY?.trim() || appSecret,
  }
}

export function isChannelLoginConfigured() {
  const config = getChannelLoginConfig()
  return Boolean(config.channelCode && config.signKey && config.loginKey)
}

// 《数智人和AI视频彩铃包月》1.4.3.8 明确写了："MSISDN...秘钥为合成 signature 字段的对应秘钥"——
// 也就是上面这个"签名密钥"。1.4.4（订购/退订通知）没有重复写这句话，但通篇没再出现第二个密钥，
// 按同一份文档的惯例先按同一个密钥处理；算法双方都是 AES-256-ECB + PKCS5Padding + Base64。
// 注意：这个密钥跟《Amber SDK 数据采集技术规范-营销全链路》里 account/phoneNumber/userId
// 要用的 aes_encrypt 密钥不是一回事——那个文档从没提过"签名密钥"，需要单独问咪咕对接人要。
function getMsisdnAesKey() {
  const { signKey } = getChannelLoginConfig()
  const key = Buffer.from(signKey, 'utf8')
  if (key.length !== 32) {
    throw new Error(`签名密钥长度不是 256 位（当前 ${key.length * 8} 位），无法用于 AES-256 加解密 MSISDN。`)
  }
  return key
}

export function decryptMiguMsisdn(base64Ciphertext) {
  const decipher = crypto.createDecipheriv('aes-256-ecb', getMsisdnAesKey(), null)
  return Buffer.concat([decipher.update(base64Ciphertext, 'base64'), decipher.final()]).toString('utf8')
}

export function encryptMiguMsisdn(plainText) {
  const cipher = crypto.createCipheriv('aes-256-ecb', getMsisdnAesKey(), null)
  return Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]).toString('base64')
}

// 《数智人和AI视频彩铃包月》接口说明《登陆接口》——免鉴权模式：
// 用 channelCode + 免鉴权登录秘钥 换一个一次性 token，这个 token 就是登录验证页面要用的 cToken。
// Signature 规则：MD5(渠道号+时间戳+签名密钥) 拼接（不是冒号分隔，跟 Token 计费接口的签名规则不一样）
export async function mintCToken() {
  const { channelCode, signKey, loginKey } = getChannelLoginConfig()
  if (!channelCode || !signKey || !loginKey) {
    throw new Error(
      '渠道登录未配置完整（MIGU_CHANNEL_CODE / MIGU_CHANNEL_LOGIN_SIGN_KEY / MIGU_CHANNEL_LOGIN_KEY），请检查 .env。',
    )
  }
  const timestamp = formatDateTimestamp(new Date())
  const signature = crypto.createHash('md5').update(`${channelCode}${timestamp}${signKey}`).digest('hex')
  const payload = { channelCode, timestamp, signature, key: loginKey }
  const url = `${CHANNEL_LOGIN_BASE_URL}${CHANNEL_LOGIN_PATH}?data=${encodeURIComponent(JSON.stringify(payload))}`

  const response = await fetch(url)
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) {
    throw new Error(`渠道登录接口请求失败：HTTP ${response.status}`)
  }
  if (!data.token) {
    throw new Error(data.resMsg || '渠道登录接口未返回 token（cToken）。')
  }
  return data.token
}

// 登录验证页面：把浏览器整页跳转到这个地址，咪咕登录完成后会带 btoken/vuid 回调到 cburl
export async function buildLoginRedirectUrl() {
  assertConfigured()
  const cToken = await mintCToken()
  const config = getConfig()
  const params = new URLSearchParams({
    appId: config.appId,
    schannel: config.channelCode,
    cburl: config.callbackUrl,
    cToken,
  })
  if (config.projectId) params.set('projectId', config.projectId)
  return `${LOGIN_PAGE_BASE}?${params.toString()}`
}

// 获取 taskId 页面：同样是整页跳转，咪咕会把 taskId（或 resumeCode/code）带回 cburl
export function buildTaskIdRedirectUrl({ btoken, modelValue, contentType }) {
  assertConfigured()
  if (!btoken) throw new Error('缺少 btoken，请先完成登录。')
  if (!modelValue) throw new Error('缺少 modelValue（模态值）。')
  const config = getConfig()
  const params = new URLSearchParams({
    appId: config.appId,
    schannel: config.channelCode,
    cburl: config.callbackUrl,
    btoken,
    modelValue,
  })
  if (config.projectId) params.set('projectId', config.projectId)
  if (contentType) params.set('contentType', contentType)
  return `${TASK_ID_PAGE_BASE}?${params.toString()}`
}

// 视频生成成功后的彩铃发布页。文档要求 token 由登录接口重新获取且只能使用一次，
// 因此不能复用登录跳转时的 cToken，也不能把长期 btoken 当作这里的 token。
export async function buildPublishRedirectUrl({ videoUrl, videoCover }) {
  assertConfigured()
  const config = getConfig()
  if (!videoUrl) throw new Error('缺少发布视频地址。')
  if (!videoCover) throw new Error('缺少视频封面地址。')
  if (!config.watermarkId) throw new Error('缺少 MIGU_WATERMARK_ID 配置，无法打开视频彩铃发布页。')
  if (!config.projectId) throw new Error('缺少 MIGU_PROJECT_ID 配置，无法打开视频彩铃发布页。')
  if (!config.releaseId) throw new Error('缺少 MIGU_RELEASE_ID 配置，无法打开视频彩铃发布页。')

  const token = await mintCToken()
  const params = new URLSearchParams({
    videoUrl,
    videoCover,
    watermarkId: config.watermarkId,
    projectId: config.projectId,
    releaseId: config.releaseId,
    token,
    tokenType: 'MGPT',
  })
  return `${PUBLISH_PAGE_BASE}?${params.toString()}`
}

// 分贝明细页（Token 使用明细）：直接打开即可，不需要跳转再回调
export function buildUsageDetailUrl({ token, cfrom }) {
  const config = getConfig()
  if (!config.projectId) {
    throw new Error('缺少 MIGU_PROJECT_ID 配置，无法生成分贝明细页地址。')
  }
  if (!token) {
    throw new Error('缺少 token，请先完成登录。')
  }
  const params = new URLSearchParams({
    notice: '1',
    cfrom: cfrom || process.env.MIGU_USAGE_DETAIL_CFROM?.trim() || 'ecoH5',
    showSkillDetails: '1',
    token,
    tokenType: 'MGPT',
    projectId: config.projectId,
  })
  return `${USAGE_DETAIL_PAGE_BASE}?${params.toString()}`
}

// 服务端接口签名：MD5(appId:appSecret:x-mgmusic-otoken:timestamp:nonce)
function buildSignedHeaders(otoken) {
  const config = getConfig()
  const timestamp = String(Date.now())
  const nonce = crypto.randomBytes(8).toString('hex')
  const signature = crypto
    .createHash('md5')
    .update(`${config.appId}:${config.appSecret}:${otoken}:${timestamp}:${nonce}`)
    .digest('hex')
  return {
    'content-type': 'application/json',
    appId: config.appId,
    'x-mgmusic-osign': signature,
    'x-mgmusic-otoken': otoken,
    timestamp,
    nonce,
  }
}

async function callSignedApi(path, otoken, body) {
  assertConfigured()
  if (!otoken) {
    throw new Error('缺少业务 token（btoken/otoken），请先完成登录。')
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: buildSignedHeaders(otoken),
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload) {
    throw new Error(`咪咕接口请求失败：HTTP ${response.status}`)
  }
  if (payload.code && payload.code !== '000000') {
    throw new Error(payload.info || `咪咕接口返回错误码 ${payload.code}`)
  }
  return payload.data ?? payload
}

export async function queryTokenRemainCount({ otoken, modelValue }) {
  return callSignedApi('/open/api/ringbacktone/ai-ability/remain-count/v1.0', otoken, {
    appId: getConfig().appId,
    modelValue,
  })
}

export async function preDeductToken({ otoken, taskId, contentType, modelValue, rcToken }) {
  return callSignedApi('/open/api/user/ai-charging/pre/reduce/v1.0', otoken, {
    taskId,
    appId: getConfig().appId,
    contentType,
    modelValue,
    ...(rcToken ? { rcToken } : {}),
  })
}

export async function cancelTokenTask({ otoken, taskId }) {
  return callSignedApi('/open/api/user/ai-charging/cancel/task/v1.0', otoken, {
    taskId,
    appId: getConfig().appId,
  })
}

export async function reportTokenResult({ otoken, taskId, result, inputContents, finalResults, mediumResults }) {
  return callSignedApi('/open/api/user/ai-charging/report/result/v1.0', otoken, {
    taskId,
    appId: getConfig().appId,
    result,
    inputContents,
    ...(finalResults ? { finalResults } : {}),
    ...(mediumResults ? { mediumResults } : {}),
  })
}

export async function reportInteraction({ otoken, ask, ans, ansBy }) {
  return callSignedApi('/open/api/user/ai-charging/report/interact/v1.0', otoken, {
    appId: getConfig().appId,
    ask,
    ans,
    ansBy,
  })
}
