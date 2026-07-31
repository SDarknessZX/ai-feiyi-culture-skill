// Amber SDK 埋点上报 —— 参考《Amber_Web_SDK集成手册》3.2 无埋点/埋点集成说明 + 权益使用页合规要求
// SDK 本体在 index.html 里异步引入；这里只是按文档规定的 EID/EK/EV 组装 _amberTrack 调用。
type AmberParam = { EK: string; EV: string }

// _amberTrack 的 EV 在 qingyuan.ts 里还会传对象（setGeneralProps/bussinessProcessing），
// 这里的全局类型声明要跟那边保持一致，否则两个文件的 declare global 会冲突
declare global {
  interface Window {
    _amberTrack?: (id: string, data: Array<{ EK: string; EV: string | Record<string, unknown> }>) => void
  }
}

const appId = import.meta.env.VITE_MIGU_AIGC_APP_ID?.trim() || ''
const scene = import.meta.env.VITE_MIGU_PROJECT_ID?.trim() || ''
const channel = import.meta.env.VITE_MIGU_CHANNEL_CODE?.trim() || ''

function baseParams(vuid?: string): AmberParam[] {
  const params: AmberParam[] = [
    { EK: 'appId', EV: appId },
    { EK: 'scene', EV: scene },
    { EK: 'channel', EV: channel },
  ]
  if (vuid) params.push({ EK: 'vuid', EV: vuid })
  return params
}

function track(eid: string, extra: AmberParam[], vuid?: string) {
  // 公共参数（appId/scene/channel）文档标注任何事件都要上报，缺了就不上报，避免脏数据
  if (!appId || !scene || !channel) return
  window._amberTrack?.(eid, [...baseParams(vuid), ...extra])
}

// a. 登录事件：用户完成登录（含失败）时上报
export function trackAmberLogin(result: 'success' | 'fail', vuid?: string) {
  track(
    'music_aigc_login',
    [
      { EK: 'triggerType', EV: '2' },
      { EK: 'loginResult', EV: result === 'success' ? '0' : '1' },
    ],
    vuid,
  )
}

// b. 创作页访问事件：用户访问 AI 应用主页时上报一次
export function trackAmberEnter(vuid?: string) {
  track('music_aigc_enter', [{ EK: 'triggerType', EV: '1' }], vuid)
}

// c. 用户交互事件：非创作类交互，如点击引导对话框、快捷输入进行对话
export function trackAmberInteract(vuid?: string) {
  track('music_aigc_interact', [{ EK: 'triggerType', EV: '8' }], vuid)
}

// d. 创作任务提交事件：素材上传/选择完成，点击"立即生成"/"生成视频"时上报（需要真实 taskId）
export function trackAmberSubmitTask(taskId: string, templateId?: string, vuid?: string) {
  const extra: AmberParam[] = [
    { EK: 'triggerType', EV: '2' },
    { EK: 'taskId', EV: taskId },
  ]
  if (templateId) extra.push({ EK: 'templateId', EV: templateId })
  track('music_aigc_submit_task', extra, vuid)
}

// e. 创作任务完成事件：任务生成成功时上报
export function trackAmberCompleteTask(
  taskId: string,
  videoUrl: string,
  templateId?: string,
  templateName?: string,
  vuid?: string,
) {
  const extra: AmberParam[] = [
    { EK: 'triggerType', EV: '2' },
    { EK: 'taskId', EV: taskId },
    { EK: 'videoUrl', EV: videoUrl },
  ]
  if (templateId) extra.push({ EK: 'templateId', EV: templateId })
  if (templateName) extra.push({ EK: 'templateName', EV: templateName })
  track('music_aigc_complete_task', extra, vuid)
}

// f（视频彩铃发布事件）依赖发布页功能，现在应用里还没有"发布到彩铃"入口，先不做。
