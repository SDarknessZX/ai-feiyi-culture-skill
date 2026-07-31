// 清源行动埋点 —— 参考《Amber SDK 数据采集技术规范-营销全链路 v1.3》
// 4 个事件必须以 qingyuan_ 开头：qingyuan_page_load / qingyuan_user_login / qingyuan_page_stay / qingyuan_traceLog
//
// 文档要求 account、phoneNumber、userId 这三处字段一律用 aes_encrypt 脱敏处理，密钥需要找咪咕公司对接人获取。
// 现在没有这个密钥，所以这几个字段暂时一律不发送（宁可字段缺失，也不能把明文账号/手机号发出去）。
// 等拿到密钥后，把 encryptForQingyuan() 换成真正的 AES 实现，再把注释掉的字段加回去即可。

type QingyuanValue = string | Record<string, unknown>
type QingyuanParam = { EK: string; EV: QingyuanValue }

// _amberTrack 的全局类型声明要跟 amber.ts 里的保持结构一致，否则两边的 declare global 会冲突
declare global {
  interface Window {
    _amberTrack?: (id: string, data: Array<{ EK: string; EV: string | Record<string, unknown> }>) => void
    AmberWebSdk?: {
      getSdkTraceId?: () => string
    }
  }
}

const channelId = import.meta.env.VITE_MIGU_CHANNEL_CODE?.trim() || ''
const entrySourceStorageKey = 'ai-yitu-zhenying-qingyuan-entry-source'

let currentPageSeq = 1
export function advanceQingyuanPageSeq() {
  currentPageSeq += 1
}

// 核验表要填 sdkTraceId，这里第一次拿到非空值时打一条日志，测试的人开控制台就能直接复制，
// 不用自己敲 window.AmberWebSdk.getSdkTraceId() 那行命令
let loggedSdkTraceId = false
function getSdkTraceId(): string {
  const traceId = window.AmberWebSdk?.getSdkTraceId?.() || ''
  if (traceId && !loggedSdkTraceId) {
    loggedSdkTraceId = true
    console.log('[清源行动] sdkTraceId（核验表要填的串联ID）：', traceId)
  }
  return traceId
}

// 会话首次入口页面 URL 的 base64 编码，整个会话固定不变
function getEntrySource(): string {
  try {
    let stored = window.sessionStorage.getItem(entrySourceStorageKey)
    if (!stored) {
      const bytes = new TextEncoder().encode(window.location.href)
      stored = window.btoa(String.fromCharCode(...bytes))
      window.sessionStorage.setItem(entrySourceStorageKey, stored)
    }
    return stored
  } catch {
    return ''
  }
}

// 用户是从咪咕 APP 内打开的还是普通浏览器打开的，是我们唯一能可靠判断的流量来源信息，
// 其余广告投放类的来源（信息流/短视频广告等）我们没有归因数据，一律标未知（99）
function detectSourcePlat(isInMiguApp: boolean, isInMiniprogram: boolean): string {
  if (isInMiniprogram) return '8' // 小程序
  if (isInMiguApp) return '1' // APP（端内）
  return '99' // 未知
}

function commonFields(options: { pageName?: string; isInMiguApp?: boolean; isInMiniprogram?: boolean }): QingyuanParam[] {
  const fields: QingyuanParam[] = [
    { EK: 'sdkTraceId', EV: getSdkTraceId() },
    { EK: 'entrySource', EV: getEntrySource() },
    { EK: 'sourceType', EV: '99' },
    { EK: 'sourcePlat', EV: detectSourcePlat(Boolean(options.isInMiguApp), Boolean(options.isInMiniprogram)) },
    { EK: 'globalPlatform', EV: '1' },
    { EK: 'pageSeq', EV: String(currentPageSeq) },
    { EK: 'channelId', EV: channelId },
    { EK: 'companyId', EV: 'MGWH000' },
    { EK: 'companyName', EV: '咪咕文化' },
  ]
  if (options.pageName) fields.push({ EK: 'pageName', EV: options.pageName })
  return fields
}

function track(eid: string, fields: QingyuanParam[]) {
  if (!channelId) return
  window._amberTrack?.(eid, fields)
}

// 页面加载事件：首屏就绪后上报一次
export function trackQingyuanPageLoad(
  loadTimeMs: number,
  options: { success?: boolean; pageName?: string; isInMiguApp?: boolean; isInMiniprogram?: boolean } = {},
) {
  track('qingyuan_page_load', [
    ...commonFields(options),
    { EK: 'loadTime', EV: String(Math.max(0, Math.round(loadTimeMs))) },
    { EK: 'resultCode', EV: options.success === false ? '1' : '0' },
  ])
}

// 账号登录事件：真实咪咕登录完成（成功/失败）时上报
export function trackQingyuanUserLogin(
  result: 'success' | 'fail',
  options: { pageName?: string; isInMiguApp?: boolean; isInMiniprogram?: boolean } = {},
) {
  track('qingyuan_user_login', [
    ...commonFields(options),
    // accountType: 99（第三方登录——咪咕 vuid，不属于手机号/邮箱/微信/QQ/微博/自定义账号/支付宝里的任何一种）
    { EK: 'accountType', EV: '99' },
    { EK: 'resultCode', EV: result === 'success' ? '0' : '1' },
    // account/phoneNumber 需要 aes_encrypt，密钥未获取前不发送明文
  ])
}

// 页面停留事件：离开页面/切后台时上报本次停留时长
export function trackQingyuanPageStay(
  stayTimeMs: number,
  options: { pageName?: string; isInMiguApp?: boolean; isInMiniprogram?: boolean } = {},
) {
  track('qingyuan_page_stay', [
    ...commonFields(options),
    { EK: 'stayTime', EV: String(Math.max(0, Math.round(stayTimeMs))) },
  ])
}

export type QingyuanProcessType =
  | '2' // 前往办理（拉起统一支付页/整页跳转咪咕拿 taskId）
  | '8' // 办理结束（成功或失败都要报）
  | '9' // 页面关闭
  | '10' // 取消前往办理

type QingyuanTraceLogOptions = {
  processId: number
  processType: QingyuanProcessType
  pageName?: string
  isInMiguApp?: boolean
  isInMiniprogram?: boolean
  orderId?: string
  fee?: string
  goodsId?: string
  goodsName?: string
  contentId?: string
  resultCode?: '0' | '1'
  errorMessage?: string
  clickElement?: string
}

// 业务办理日志：AI 创作没有传统意义上的"手机号+验证码"办理流程，这里按最接近的语义映射——
// 整页跳转去咪咕拿 taskId 算"前往办理"(2)，创作成功/失败算"办理结束"(8)。
export function trackQingyuanTraceLog(options: QingyuanTraceLogOptions) {
  const generalProps = {
    globalTypes: '99', // 不是话费支付/免费流量/三方支付，用"其他"
    globalOptType: '99',
    globalApiId: 'SDK',
    globalApiName: 'AI创作生成',
  }
  const bussinessProcessing: Record<string, unknown> = {
    processId: options.processId,
    processType: options.processType,
    apiId: 'SDK',
    apiName: 'AI创作生成',
    orderId: options.orderId || '999999',
    fee: options.fee || '0',
    channelId,
    cpId: '999999',
  }
  if (options.goodsId) bussinessProcessing.goodsId = options.goodsId
  if (options.goodsName) bussinessProcessing.goodsName = options.goodsName
  if (options.contentId) bussinessProcessing.contentId = options.contentId
  if (options.resultCode) bussinessProcessing.resultCode = options.resultCode
  if (options.errorMessage) bussinessProcessing.errorMessage = options.errorMessage
  // phoneNumber 需要 aes_encrypt，密钥未获取前不发送

  const extra: QingyuanParam[] = [
    { EK: 'setGeneralProps', EV: generalProps },
    { EK: 'bussinessProcessing', EV: bussinessProcessing },
  ]
  if (options.clickElement) extra.push({ EK: 'clickElement', EV: options.clickElement })

  track('qingyuan_traceLog', [...commonFields(options), ...extra])
}
