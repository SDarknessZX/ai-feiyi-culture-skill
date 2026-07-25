import crypto from 'node:crypto'

function getArkApiKey() {
  return process.env.ARK_API_KEY || ''
}

function getArkImageApiKey() {
  return process.env.ARK_IMAGE_API_KEY || getArkApiKey()
}

function isLikelyArkApiKey(value) {
  return /^ark-[A-Za-z0-9_-]{40,}$/.test(value)
}

function getArkBaseUrl() {
  return (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '')
}

export function getProviderConfigReport() {
  const warnings = []
  const provider = process.env.MODEL_PROVIDER || 'mock'
  const arkBaseUrl = process.env.ARK_BASE_URL || ''

  if (provider === 'ark' && !getArkApiKey()) {
    warnings.push('ARK_API_KEY is empty. Ark video generation cannot call the real model.')
  }

  if (provider === 'ark' && getArkApiKey() && !getArkApiKey().startsWith('ark-')) {
    warnings.push('ARK_API_KEY should be the Ark secret key that starts with ark-, not the api-key-* name.')
  }

  if (provider === 'ark' && getArkApiKey().startsWith('ark-') && !isLikelyArkApiKey(getArkApiKey())) {
    warnings.push('ARK_API_KEY looks incomplete. Copy the full ark-* value from Volcengine Ark API Key console.')
  }

  if (provider === 'ark' && getArkImageApiKey() && !getArkImageApiKey().startsWith('ark-')) {
    warnings.push('ARK_IMAGE_API_KEY should be the Ark secret key that starts with ark-.')
  }

  if (provider === 'ark' && getArkImageApiKey().startsWith('ark-') && !isLikelyArkApiKey(getArkImageApiKey())) {
    warnings.push('ARK_IMAGE_API_KEY looks incomplete. Copy the full ark-* value from Volcengine Ark API Key console.')
  }

  if (provider === 'ark' && !process.env.ARK_IMAGE_MODEL) {
    warnings.push('ARK_IMAGE_MODEL is empty. Costume image preprocessing will use doubao-seedream-5-0-260128 by default.')
  }

  if (provider === 'ark' && !process.env.ARK_VIDEO_MODEL) {
    warnings.push('ARK_VIDEO_MODEL is empty. Use doubao-seedance-2-0-mini-260615 or another enabled video model.')
  }

  if (provider === 'ark' && process.env.ARK_VIDEO_RESOLUTION && !['480p', '720p', '1080p', '4k'].includes(process.env.ARK_VIDEO_RESOLUTION)) {
    warnings.push('ARK_VIDEO_RESOLUTION should be one of: 480p, 720p, 1080p, 4k.')
  }

  if (provider === 'ark' && arkBaseUrl && !arkBaseUrl.includes('ark.cn-beijing.volces.com')) {
    warnings.push('ARK_BASE_URL should be https://ark.cn-beijing.volces.com/api/v3 for Ark models.')
  }

  return {
    provider,
    arkConfigured: Boolean(getArkApiKey() && process.env.ARK_VIDEO_MODEL),
    arkImageConfigured: Boolean(getArkImageApiKey()),
    arkLlmConfigured: Boolean(process.env.ARK_LLM_API_KEY || getArkApiKey()),
    warnings,
  }
}

export async function generateCostumeReferenceImage({ sourceImageUrl, prompt }) {
  if (!process.env.MODEL_PROVIDER || process.env.MODEL_PROVIDER === 'mock') {
    return sourceImageUrl
  }

  if (process.env.MODEL_PROVIDER !== 'ark') {
    return sourceImageUrl
  }

  const imageApiKey = getArkImageApiKey()
  if (!imageApiKey) {
    throw new Error('已选择火山方舟，但还缺 ARK_IMAGE_API_KEY 或 ARK_API_KEY，无法先生成换装参考图。')
  }

  const payload = {
    model: process.env.ARK_IMAGE_MODEL || 'doubao-seedream-5-0-260128',
    prompt,
    image: [sourceImageUrl],
    sequential_image_generation: 'disabled',
    response_format: 'url',
    size: process.env.ARK_IMAGE_SIZE || '2K',
    stream: false,
    watermark: process.env.ARK_IMAGE_WATERMARK === 'false' ? false : true,
  }

  const data = await arkPost('/images/generations', payload, {
    apiKey: imageApiKey,
    label: '图片预处理请求',
  })
  const generatedImageUrl = findUrl(data)

  if (!generatedImageUrl) {
    throw new Error(`Ark 图片预处理响应里没有找到图片 URL：${JSON.stringify(data)}`)
  }

  return generatedImageUrl
}

export async function submitImageToVideoTask({ mode, imageUrl, prompt }) {
  if (!process.env.MODEL_PROVIDER || process.env.MODEL_PROVIDER === 'mock') {
    return createMockTask({
      message: `模拟调用${mode === 'painting' ? '画作动态还原' : '多模态视频生成'}模型：${prompt}`,
    })
  }

  if (process.env.MODEL_PROVIDER !== 'ark') {
    return createMockTask({
      message: `已进入 ${process.env.MODEL_PROVIDER} 适配位。请在 server/providers 中补齐该平台接口。素材：${imageUrl}`,
    })
  }

  if (!getArkApiKey() || !process.env.ARK_VIDEO_MODEL) {
    return createMockTask({
      message: '已选择火山方舟，但还缺 ARK_API_KEY 或 ARK_VIDEO_MODEL。先补齐 .env 后再接真实图生视频接口。',
    })
  }

  const payload = {
    model: process.env.ARK_VIDEO_MODEL,
    content: [
      {
        type: 'text',
        text: prompt,
      },
      {
        type: 'image_url',
        image_url: {
          url: imageUrl,
        },
        role: 'reference_image',
      },
    ],
    generate_audio: true,
    ratio: '9:16',
    duration: 10,
    resolution: process.env.ARK_VIDEO_RESOLUTION || '720p',
    watermark: false,
  }

  const data = await arkPost('/contents/generations/tasks', payload, {
    apiKey: getArkApiKey(),
    label: '视频生成请求',
  })
  const taskId = findTaskId(data)

  if (!taskId) {
    throw new Error(`Ark 提交响应里没有找到任务 ID：${JSON.stringify(data)}`)
  }

  return {
    taskId,
    status: 'queued',
    message:
      mode === 'costume'
        ? '已完成换装参考图预处理，并提交带背景音频的视频生成任务。'
        : mode === 'food'
          ? '已识别美食并生成专属视频提示词，正在生成带音效的约 10 秒萌系美食视频。'
          : '已提交视频生成任务，正在生成约 10 秒竖版短视频。',
  }
}

export async function queryVideoGenerationTask(taskId) {
  if (taskId.startsWith('mock')) {
    return {
      taskId,
      status: 'succeeded',
      message: '本地模拟任务已完成。',
      videoUrl: '',
    }
  }

  const data = await arkGet(`/contents/generations/tasks/${taskId}`, {
    apiKey: getArkApiKey(),
    label: '视频生成查询',
  })

  if (isPolicyViolation(data)) {
    return {
      taskId,
      status: 'failed',
      message: buildPolicyViolationMessage(data),
      videoUrl: '',
      raw: data,
    }
  }

  const status = normalizeTaskStatus(data)
  const videoUrl = findUrl(data)

  return {
    taskId,
    status,
    message: buildTaskMessage(status, data, videoUrl),
    videoUrl,
    raw: data,
  }
}

async function arkPost(path, payload, { apiKey, label }) {
  const response = await fetch(`${getArkBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return parseArkResponse(response, label)
}

async function arkGet(path, { apiKey, label }) {
  const response = await fetch(`${getArkBaseUrl()}${path}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
  })

  return parseArkResponse(response, label)
}

async function parseArkResponse(response, label) {
  const raw = await response.text()
  let data
  try {
    data = raw ? JSON.parse(raw) : {}
  } catch {
    data = { raw }
  }

  if (!response.ok || data.error) {
    const detail = formatErrorDetail(data) || response.statusText
    throw new Error(`Ark ${label}失败：HTTP ${response.status} ${detail}`)
  }

  return data
}

function normalizeTaskStatus(data) {
  if (isPolicyViolation(data)) {
    return 'failed'
  }

  const value = String(
    data.status ||
      data.Status ||
      data.state ||
      data.State ||
      data.task_status ||
      data.TaskStatus ||
      data.data?.status ||
      data.data?.state ||
      '',
  ).toLowerCase()

  if (['success', 'succeeded', 'finish', 'finished', 'done', 'completed', 'complete'].includes(value)) {
    return 'succeeded'
  }

  if (['fail', 'failed', 'error', 'canceled', 'cancelled'].includes(value)) {
    return 'failed'
  }

  return 'running'
}

function findUrl(value) {
  if (!value || typeof value !== 'object') return ''

  for (const key of [
    'video_url',
    'videoUrl',
    'image_url',
    'imageUrl',
    'output_url',
    'outputUrl',
    'result_url',
    'resultUrl',
    'url',
  ]) {
    if (typeof value[key] === 'string' && /^https?:\/\//.test(value[key])) {
      return value[key]
    }
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = findUrl(item)
        if (found) return found
      }
    } else if (nested && typeof nested === 'object') {
      const found = findUrl(nested)
      if (found) return found
    }
  }

  return ''
}

function findTaskId(value) {
  if (!value || typeof value !== 'object') return ''

  for (const key of ['id', 'task_id', 'taskId', 'TaskId']) {
    if (typeof value[key] === 'string' && value[key]) {
      return value[key]
    }
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = findTaskId(item)
        if (found) return found
      }
    } else if (nested && typeof nested === 'object') {
      const found = findTaskId(nested)
      if (found) return found
    }
  }

  return ''
}

function isPolicyViolation(data) {
  const code = String(data?.code || data?.error?.code || data?.data?.code || '')
  return /PolicyViolation|SensitiveContent|Copyright/i.test(code)
}

function buildPolicyViolationMessage(data) {
  const code = data?.code || data?.error?.code || 'PolicyViolation'
  return `生成结果被 Ark 内容安全策略拦截（${code}）。这通常是因为画面可能接近影视、动漫、游戏、明星、品牌或其他版权 IP。已在提示词里加入原创与版权规避约束，请更换一张照片或换一个服饰模板后重试。`
}

function formatErrorDetail(data) {
  if (!data) return ''
  if (typeof data === 'string') return data
  if (typeof data.message === 'string') return data.message
  if (typeof data.error === 'string') return data.error
  if (data.error && typeof data.error === 'object') return JSON.stringify(data.error)
  if (typeof data.raw === 'string') return data.raw
  return JSON.stringify(data)
}

function buildTaskMessage(status, data, videoUrl) {
  if (isPolicyViolation(data)) {
    return buildPolicyViolationMessage(data)
  }

  if (status === 'succeeded') {
    return videoUrl ? '视频已生成，可以预览和下载。' : '任务已完成，但响应里没有找到视频 URL，请检查 Ark 返回字段。'
  }

  if (status === 'failed') {
    return data.message || data.error || data.reason || '视频生成任务失败。'
  }

  return '视频正在生成，请稍等。'
}

function createMockTask({ message }) {
  return {
    taskId: `mock-${crypto.randomUUID().slice(0, 8)}`,
    status: 'queued',
    message,
  }
}
