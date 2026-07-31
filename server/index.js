import cors from 'cors'
import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  costumeDynastyTemplates,
  costumeEthnicTemplates,
  costumeStyleTemplates,
  findCostumeStyle,
  findPaintingStyle,
  foodShowcaseTemplates,
  paintingMotionTemplates,
} from './templates.js'
import { generateCasualChatReply, generateFoodVideoPrompt } from './providers/arkResponses.js'
import {
  generateCostumeReferenceImage,
  getProviderConfigReport,
  queryVideoGenerationTask,
  submitImageToVideoTask,
} from './providers/arkVideo.js'
import { checkContent, getContentAuditConfigReport, handleAuditCallback } from './providers/contentAudit.js'
import {
  buildLoginRedirectUrl,
  buildTaskIdRedirectUrl,
  buildUsageDetailUrl,
  decryptMiguMsisdn,
  getMiguAigcConfigReport,
  getModelValueForMode,
  isTokenGatingEnabled,
  preDeductToken,
  queryTokenRemainCount,
  reportInteraction,
  reportTokenResult,
} from './providers/miguAigc.js'
import { cacheGeneratedVideo } from './providers/generatedVideoStorage.js'
import { archiveGeneratedVideo, ensureArchivedVideoPoster } from './providers/videoArchive.js'
import { createCompliantVideoBuffer, getVideoComplianceConfigReport } from './providers/videoCompliance.js'
import { createVideoPosterBuffer } from './providers/videoPoster.js'
import { getTosConfigReport, uploadFileToTos } from './providers/tosStorage.js'
import { detectFaces, getFaceDetectionConfigReport } from './providers/faceDetection.js'
import { buildCostumeReferencePrompt, buildCostumeVideoPrompt, foodSystemPrompt } from './promptLibrary.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const generatedVideosRoot = path.join(__dirname, '..', 'generated-videos')

const app = express()
const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: {
    fileSize: 12 * 1024 * 1024,
  },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype?.startsWith('image/')) {
      return callback(null, true)
    }
    const error = new Error('仅支持上传图片文件。')
    error.statusCode = 400
    callback(error)
  },
})

const createSchema = z.object({
  mode: z.enum(['costume', 'food', 'painting']),
  template: z.string().optional().default(''),
  gender: z.enum(['female', 'male']).optional().default('female'),
})

const chatSchema = z.object({
  message: z.string().trim().min(1).max(300),
})

const posterSchema = z.object({
  taskId: z.string().regex(/^[\w-]{1,128}$/).optional(),
  videoUrl: z.string().trim().min(1).max(2048),
})

const taskIdPattern = /^[\w-]{1,128}$/
const generatedVideoNamePattern = /^[\w.-]+\.mp4$/i
const templateVideoNamePattern = /^[^\\/]+\.mp4$/i
const maxPosterSourceBytes = 60 * 1024 * 1024

// 创建任务改为异步：/api/create 立刻返回 job id，重活在后台跑，
// 避免公网隧道对长请求超时（serveo 等隧道等不到响应会回 502）。
const jobs = new Map()
const jobTtlMs = 3 * 60 * 60 * 1000

function updateJob(jobId, patch) {
  const job = jobs.get(jobId)
  if (!job) return
  Object.assign(job, patch, { updatedAt: Date.now() })
}

setInterval(() => {
  const now = Date.now()
  for (const [jobId, job] of jobs) {
    if (now - job.updatedAt > jobTtlMs) jobs.delete(jobId)
  }
}, 10 * 60 * 1000).unref()

async function runCreateJob({ jobId, mode, gender, style, file, imageUrl }) {
  try {
    updateJob(jobId, { status: 'running' })

    if (mode === 'food') {
      updateJob(jobId, { message: '正在识别美食并生成专属提示词...' })
      const generatedPrompt = await generateFoodVideoPrompt({
        imageUrl,
        systemPrompt: foodSystemPrompt,
      })
      updateJob(jobId, { message: '正在提交视频生成任务...' })
      const task = await submitImageToVideoTask({ mode, imageUrl, prompt: generatedPrompt })
      updateJob(jobId, { arkTaskId: task.taskId, message: task.message })
      return
    }

    if (mode === 'costume') {
      updateJob(jobId, { message: '正在生成换装参考图（约需 1 分钟）...' })
      const costumeReferenceImageUrl = await generateCostumeReferenceImage({
        sourceImageUrl: imageUrl,
        prompt: buildCostumeReferencePrompt(),
      })
      updateJob(jobId, { message: '参考图已生成，正在提交视频生成任务...' })
      const task = await submitImageToVideoTask({
        mode,
        imageUrl: costumeReferenceImageUrl,
        prompt: buildCostumeVideoPrompt({ stylePrompt: style.prompt, gender }),
      })
      updateJob(jobId, { arkTaskId: task.taskId, message: task.message })
      return
    }

    updateJob(jobId, { message: '正在提交视频生成任务...' })
    const task = await submitImageToVideoTask({ mode, imageUrl, prompt: style.prompt })
    updateJob(jobId, { arkTaskId: task.taskId, message: task.message })
  } catch (error) {
    updateJob(jobId, {
      status: 'failed',
      message: error instanceof Error ? error.message : '任务处理失败。',
    })
  } finally {
    if (file?.path) {
      try {
        await unlink(file.path)
      } catch {
        // 忽略清理失败
      }
    }
  }
}

// 简易限流：生成接口会消耗付费额度，默认每个 IP 每 10 分钟最多 20 次。
const createRequestLog = new Map()
function rateLimitCreate(request, response, next) {
  const windowMs = 10 * 60 * 1000
  const maxRequests = Number(process.env.CREATE_RATE_LIMIT || 20)
  const now = Date.now()
  const recent = (createRequestLog.get(request.ip) || []).filter((time) => now - time < windowMs)
  if (recent.length >= maxRequests) {
    return response.status(429).json({
      status: 'failed',
      message: '生成请求过于频繁，请稍后再试。',
    })
  }
  recent.push(now)
  createRequestLog.set(request.ip, recent)
  next()
}

// costume/painting 模式需要校验模板并取出生成提示词；food 模式没有模板，直接放行。
// /api/create 和 /api/create/start 都要做这个校验，抽成公共函数避免逻辑漂移。
function resolveStyle(mode, template) {
  if (mode === 'costume') {
    const style = findCostumeStyle(template)
    if (!style) {
      return { status: 404, error: { message: '未找到所选服饰模板，请刷新页面后重新选择。' } }
    }
    if (!style.prompt) {
      return {
        status: 400,
        error: { templateTitle: style.title, message: `“${style.title}”暂未配置生成提示词，请先选择已有提示词的服饰模板。` },
      }
    }
    return { style, templateTitle: style.title }
  }
  if (mode === 'painting') {
    const style = findPaintingStyle(template)
    if (!style) {
      return { status: 404, error: { message: '未找到所选画作模板，请刷新页面后重新选择。' } }
    }
    if (!style.prompt) {
      return {
        status: 400,
        error: { templateTitle: style.title, message: `“${style.title}”暂未配置生成提示词，请检查 prompts/painting/paint.txt。` },
      }
    }
    return { style, templateTitle: style.title }
  }
  return { style: null, templateTitle: 'AI识别美食' }
}

// Token 计费结果上报：一个 job 最多上报一次，成功/失败都要报，否则用户的 Token 权益会一直卡在预扣状态
async function reportTokenOutcomeIfNeeded(jobId, result, { inputImageUrl, videoUrl }) {
  const job = jobId.startsWith('job-') ? jobs.get(jobId) : null
  if (!job?.miguTaskId || job.tokenReported) return
  updateJob(jobId, { tokenReported: true })
  try {
    await reportTokenResult({
      otoken: job.miguOtoken,
      taskId: job.miguTaskId,
      result,
      inputContents: [{ contentType: 'image', content: inputImageUrl || job.inputImageUrl || '' }],
      ...(result && videoUrl ? { finalResults: [{ contentType: 'video', content: videoUrl }] } : {}),
    })
  } catch (error) {
    console.error(`[migu] Token 使用结果上报失败（jobId=${jobId}, miguTaskId=${job.miguTaskId}）：`, error)
  }
}

function publicCostume(template) {
  return {
    id: template.id,
    title: template.title,
    group: template.group,
    imageUrl: template.imageUrl,
    videoUrl: template.videoUrl,
  }
}

function publicPainting(template) {
  return {
    id: template.id,
    title: template.title,
    imageUrl: template.imageUrl,
    videoUrl: template.videoUrl,
  }
}

function getFallbackChatReply(message) {
  const normalized = String(message || '')
  if (/早|上午|早上好/.test(normalized)) {
    return '早上好！今天适合从一张照片开始，把非遗服饰或画作做成一支小短片。'
  }
  if (/笑话|冷笑话/.test(normalized)) {
    return '为什么可乐从不吵架？因为它一开口就冒泡。轻松一下，继续创作也正好。'
  }
  if (/幸运|数字|颜色|色/.test(normalized)) {
    return '今天的幸运数是 9，幸运色是晴空蓝，刚好适合做一支 9:16 竖版视频。'
  }
  return '收到，这个想法挺适合放进灵感区。也可以上传一张图片，我来帮你生成非遗创意短片。'
}

app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined))
app.use(express.json())
app.use('/templates', express.static(path.join(__dirname, '..', 'public', 'templates')))
app.use('/generated-videos', express.static(generatedVideosRoot))
// 公网访问直接走这里的生产构建（npm run build 产物），比 vite 开发模式快得多
app.use(express.static(path.join(__dirname, '..', 'dist')))

app.get('/api/health', (_request, response) => {
  const config = getProviderConfigReport()
  response.json({
    ok: true,
    provider: config.provider,
    config: {
      ...config,
      compliance: getVideoComplianceConfigReport(),
      faceDetection: getFaceDetectionConfigReport(),
      tos: getTosConfigReport(),
      contentAudit: getContentAuditConfigReport(),
      miguAigc: getMiguAigcConfigReport(),
    },
  })
})
app.get('/api/migu/login-url', async (request, response) => {
  try {
    const url = await buildLoginRedirectUrl()
    response.json({ url })
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : '无法生成登录地址。' })
  }
})
app.get('/api/migu/usage-detail-url', (request, response) => {
  const token = String(request.query.token || '').trim()
  const cfrom = request.query.cfrom ? String(request.query.cfrom).trim() : undefined
  try {
    const url = buildUsageDetailUrl({ token, cfrom })
    response.json({ url })
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : '无法生成分贝明细页地址。' })
  }
})
app.get('/api/migu/token-gating', (_request, response) => {
  response.json({ enabled: isTokenGatingEnabled() })
})
app.get('/api/migu/task-id-url', (request, response) => {
  const btoken = String(request.query.btoken || '').trim()
  const mode = String(request.query.mode || '').trim()
  const modelValue = getModelValueForMode(mode)
  if (!modelValue) {
    return response.status(400).json({ message: `不支持的玩法模态：${mode || '（空）'}` })
  }
  try {
    const url = buildTaskIdRedirectUrl({ btoken, modelValue, contentType: 'video' })
    response.json({ url })
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : '无法生成获取 taskId 页面地址。' })
  }
})
app.get('/api/migu/token/remain', async (request, response) => {
  const otoken = String(request.query.otoken || '').trim()
  const mode = String(request.query.mode || '').trim()
  const modelValue = getModelValueForMode(mode)
  if (!modelValue) {
    return response.status(400).json({ message: `不支持的玩法模态：${mode || '（空）'}` })
  }
  try {
    const data = await queryTokenRemainCount({ otoken, modelValue })
    response.json(data)
  } catch (error) {
    response.status(502).json({ message: error instanceof Error ? error.message : 'Token 权益查询失败。' })
  }
})
const interactSchema = z.object({
  otoken: z.string().trim().min(1).max(256),
  ans: z.string().trim().min(1).max(2000),
  ask: z.string().trim().max(2000).optional().default(''),
  ansBy: z.enum(['popup', 'input', 'shortcut']).optional().default('input'),
})
app.post('/api/migu/token/interact', async (request, response) => {
  const parsed = interactSchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ message: '请求参数不正确。' })
  }
  try {
    await reportInteraction(parsed.data)
    response.json({ ok: true })
  } catch (error) {
    // 这个上报失败不应该打断用户的聊天体验，记日志就好
    console.error('[migu] 用户交互上报失败：', error)
    response.json({ ok: false })
  }
})
// 《数智人和AI视频彩铃包月》1.4.4 订购/退订通知接口——包月开通/暂停/恢复/退订时咪咕会回调这里。
// msisdn 是 AES-256-ECB 加密过的手机号，密钥用的是登录接口那个"签名密钥"（1.4.3.8 原文写明）。
app.post('/api/migu/subscription-notify', async (request, response) => {
  const { msisdn, ...rest } = request.body || {}
  let maskedMsisdn = msisdn
  if (msisdn) {
    try {
      const decrypted = decryptMiguMsisdn(msisdn)
      maskedMsisdn = decrypted.length >= 7 ? `${decrypted.slice(0, 3)}****${decrypted.slice(-4)}` : '(解密成功，长度异常)'
    } catch (error) {
      maskedMsisdn = `(解密失败：${error instanceof Error ? error.message : String(error)})`
    }
  }
  console.log('咪咕订购/退订通知收到：', JSON.stringify({ ...rest, msisdn: maskedMsisdn }, null, 2))
  response.json({ code: '000000', info: 'success' })
})
app.post('/api/compliance/callback', async (request, response) => {
  console.log('机审回调收到：', JSON.stringify(request.body, null, 2))
  handleAuditCallback(request.body)

  response.json({
    code: '000000',
    info: 'success',
  })
})
app.get('/api/templates', (_request, response) => {
  response.json({
    costumes: costumeStyleTemplates.map(publicCostume),
    costumeEthnic: costumeEthnicTemplates.map(publicCostume),
    costumeDynasty: costumeDynastyTemplates.map(publicCostume),
    food: foodShowcaseTemplates,
    paintings: paintingMotionTemplates.map(publicPainting),
  })
})

app.post('/api/face-detect', upload.single('image'), async (request, response) => {
  if (!request.file) {
    return response.status(400).json({
      hasFace: false,
      faceBoundingBoxes: [],
      message: '请先上传一张需要检测人脸的图片。',
    })
  }

  try {
    const result = await detectFaces(request.file)
    return response.json({
      hasFace: result.hasFace,
      faceBoundingBoxes: result.faceBoundingBoxes,
      message: result.hasFace ? '人脸校验通过。' : '未检测到清晰人脸，请重新上传。',
    })
  } catch (error) {
    console.error('YuNet 人脸检测失败：', error)
    return response.status(503).json({
      hasFace: false,
      faceBoundingBoxes: [],
      message: error instanceof Error ? error.message : '人脸检测服务暂不可用，请稍后重试。',
    })
  } finally {
    await cleanupUpload(request)
  }
})

app.post('/api/chat', async (request, response) => {
  const parsed = chatSchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({
      reply: '我还没收到要聊的内容，可以换一句再试试。',
      source: 'fallback',
    })
  }

  try {
    const reply = await generateCasualChatReply({ message: parsed.data.message })
    return response.json({ reply, source: 'llm' })
  } catch (error) {
    console.warn('闲聊模型回复失败，使用本地兜底：', error)
    return response.json({
      reply: getFallbackChatReply(parsed.data.message),
      source: 'fallback',
    })
  }
})

app.post('/api/video-poster', async (request, response) => {
  const parsed = posterSchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ posterUrl: '', message: '视频地址不正确，无法生成封面。' })
  }

  try {
    const videoBuffer = await loadPosterSourceVideo(request, parsed.data.videoUrl)
    const posterBuffer = await createVideoPosterBuffer(videoBuffer, parsed.data.taskId || `poster-${crypto.randomUUID()}`)
    return response.json({
      posterUrl: `data:image/jpeg;base64,${posterBuffer.toString('base64')}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成视频封面失败。'
    return response.status(422).json({ posterUrl: '', message })
  }
})

// 直接创建任务（不经过咪咕 Token 预扣）——本地/未开启 Token 计费网关时的默认路径
app.post('/api/create', rateLimitCreate, upload.single('image'), async (request, response) => {
  const parsed = createSchema.safeParse(request.body)
  if (!parsed.success) {
    await cleanupUpload(request)
    return response.status(400).json({ status: 'failed', message: '请求参数不正确。' })
  }

  const input = parsed.data
  if (!request.file) {
    return response.status(400).json({ status: 'failed', message: '请先上传一张图片。' })
  }

  if (input.mode === 'costume') {
    try {
      const faceResult = await detectFaces(request.file)
      if (!faceResult.hasFace) {
        await cleanupUpload(request)
        return response.status(422).json({
          status: 'failed',
          mode: input.mode,
          message: '未检测到清晰人脸，请重新上传后再使用民族变装。',
        })
      }
    } catch (error) {
      await cleanupUpload(request)
      return response.status(503).json({
        status: 'failed',
        mode: input.mode,
        message: error instanceof Error ? error.message : '人脸检测服务暂不可用，请稍后重试。',
      })
    }
  }

  const styleCheck = resolveStyle(input.mode, input.template)
  if (styleCheck.error) {
    await cleanupUpload(request)
    return response.status(styleCheck.status).json({ status: 'failed', mode: input.mode, ...styleCheck.error })
  }

  const jobId = `job-${crypto.randomUUID()}`

  let imageUrl
  try {
    imageUrl = await uploadFileToTos(request.file)
  } catch (error) {
    await cleanupUpload(request)
    return response.status(502).json({
      status: 'failed',
      mode: input.mode,
      message: error instanceof Error ? error.message : '图片上传失败，请稍后重试。',
    })
  }

  // 机审：用户输入的图片（换装照片/年画线稿等）过审后才允许发起创作任务
  const inputAudit = await checkContent({
    kind: 'picture',
    content: imageUrl,
    contentId: jobId,
    description: `${input.mode} 创作输入图片`,
  })
  if (!inputAudit.passed) {
    await cleanupUpload(request)
    return response.status(422).json({
      status: 'failed',
      mode: input.mode,
      message: '您的输入不适合展示哦，请修改后重试',
    })
  }

  jobs.set(jobId, {
    status: 'queued',
    mode: input.mode,
    templateTitle: styleCheck.templateTitle,
    arkTaskId: '',
    message: '任务已受理，正在准备素材...',
    updatedAt: Date.now(),
    inputImageUrl: imageUrl,
  })
  // 上传的临时文件交给后台任务用完再删，这里不能先清理
  void runCreateJob({
    jobId,
    mode: input.mode,
    gender: input.gender,
    style: styleCheck.style,
    file: request.file,
    imageUrl,
  })

  return response.json({
    taskId: jobId,
    status: 'queued',
    mode: input.mode,
    templateTitle: styleCheck.templateTitle,
    message: '任务已受理，正在后台处理，请稍候。',
  })
})

// Token 计费网关开启时的创作流程分两步：
// 1) /api/create/prepare 先做人脸检测/模板校验/上传/输入机审，拿到 imageUrl 后前端才整页跳转去咪咕拿 taskId
// 2) 跳转回来后调 /api/create/start，带上 taskId 做 Token 预扣，通过了才真正建任务
app.post('/api/create/prepare', rateLimitCreate, upload.single('image'), async (request, response) => {
  const parsed = createSchema.safeParse(request.body)
  if (!parsed.success) {
    await cleanupUpload(request)
    return response.status(400).json({ status: 'failed', message: '请求参数不正确。' })
  }

  const input = parsed.data
  if (!request.file) {
    return response.status(400).json({ status: 'failed', message: '请先上传一张图片。' })
  }

  if (input.mode === 'costume') {
    try {
      const faceResult = await detectFaces(request.file)
      if (!faceResult.hasFace) {
        await cleanupUpload(request)
        return response.status(422).json({
          status: 'failed',
          mode: input.mode,
          message: '未检测到清晰人脸，请重新上传后再使用民族变装。',
        })
      }
    } catch (error) {
      await cleanupUpload(request)
      return response.status(503).json({
        status: 'failed',
        mode: input.mode,
        message: error instanceof Error ? error.message : '人脸检测服务暂不可用，请稍后重试。',
      })
    }
  }

  const styleCheck = resolveStyle(input.mode, input.template)
  if (styleCheck.error) {
    await cleanupUpload(request)
    return response.status(styleCheck.status).json({ status: 'failed', mode: input.mode, ...styleCheck.error })
  }

  let imageUrl
  try {
    imageUrl = await uploadFileToTos(request.file)
  } catch (error) {
    await cleanupUpload(request)
    return response.status(502).json({
      status: 'failed',
      mode: input.mode,
      message: error instanceof Error ? error.message : '图片上传失败，请稍后重试。',
    })
  }
  await cleanupUpload(request)

  const inputAudit = await checkContent({
    kind: 'picture',
    content: imageUrl,
    contentId: `prepare-${crypto.randomUUID()}`,
    description: `${input.mode} 创作输入图片`,
  })
  if (!inputAudit.passed) {
    return response.status(422).json({
      status: 'failed',
      mode: input.mode,
      message: '您的输入不适合展示哦，请修改后重试',
    })
  }

  return response.json({
    status: 'ready',
    mode: input.mode,
    template: input.template,
    gender: input.gender,
    templateTitle: styleCheck.templateTitle,
    imageUrl,
  })
})

const createStartSchema = z.object({
  mode: z.enum(['costume', 'food', 'painting']),
  template: z.string().optional().default(''),
  gender: z.enum(['female', 'male']).optional().default('female'),
  templateTitle: z.string().optional().default(''),
  imageUrl: z.string().trim().min(1).max(2048),
  taskId: z.string().trim().min(1).max(128),
  otoken: z.string().trim().min(1).max(256),
})

app.post('/api/create/start', rateLimitCreate, async (request, response) => {
  const parsed = createStartSchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ status: 'failed', message: '请求参数不正确。' })
  }
  const input = parsed.data

  const styleCheck = resolveStyle(input.mode, input.template)
  if (styleCheck.error) {
    return response.status(styleCheck.status).json({ status: 'failed', mode: input.mode, ...styleCheck.error })
  }

  const modelValue = getModelValueForMode(input.mode)
  if (!modelValue) {
    return response.status(500).json({
      status: 'failed',
      mode: input.mode,
      message: `未配置「${input.mode}」对应的咪咕模态值（modelValue），请检查 .env。`,
    })
  }

  try {
    await preDeductToken({ otoken: input.otoken, taskId: input.taskId, contentType: 'video', modelValue })
  } catch (error) {
    return response.status(402).json({
      status: 'failed',
      mode: input.mode,
      message: error instanceof Error ? error.message : 'Token 权益不足或校验失败，请稍后重试。',
    })
  }

  const jobId = `job-${crypto.randomUUID()}`
  const templateTitle = input.templateTitle || styleCheck.templateTitle
  jobs.set(jobId, {
    status: 'queued',
    mode: input.mode,
    templateTitle,
    arkTaskId: '',
    message: '任务已受理，正在准备素材...',
    updatedAt: Date.now(),
    inputImageUrl: input.imageUrl,
    miguTaskId: input.taskId,
    miguOtoken: input.otoken,
    tokenReported: false,
  })
  void runCreateJob({
    jobId,
    mode: input.mode,
    gender: input.gender,
    style: styleCheck.style,
    file: null,
    imageUrl: input.imageUrl,
  })

  return response.json({
    taskId: jobId,
    status: 'queued',
    mode: input.mode,
    templateTitle,
    message: '任务已受理，正在后台处理，请稍候。',
  })
})

app.get('/api/tasks/:taskId', async (request, response) => {
  const mode = request.query.mode || 'costume'
  const { taskId } = request.params

  if (!taskIdPattern.test(taskId)) {
    return response.status(400).json({
      taskId,
      status: 'failed',
      mode,
      message: '任务 ID 格式不正确。',
    })
  }

  try {
    // 已归档的任务不再查 Ark：服务重启、Ark 链接过期都不影响已完成的作品
    const archived = await ensureArchivedVideoPoster(taskId)
    if (archived) {
      return response.json({
        taskId,
        status: 'succeeded',
        mode,
        videoUrl: archived.videoUrl,
        posterUrl: archived.posterUrl || '',
        message: '视频已生成，可以预览和下载。',
        ...(archived.templateTitle ? { templateTitle: archived.templateTitle } : {}),
      })
    }

    let arkTaskId = taskId
    let templateTitle

    if (taskId.startsWith('job-')) {
      const job = jobs.get(taskId)
      if (!job) {
        return response.json({
          taskId,
          status: 'failed',
          mode,
          message: '任务记录已丢失（服务可能重启过），请重新生成。',
        })
      }
      templateTitle = job.templateTitle
      if (!job.arkTaskId) {
        return response.json({
          taskId,
          status: job.status === 'failed' ? 'failed' : 'running',
          mode: job.mode,
          templateTitle,
          message: job.message,
        })
      }
      arkTaskId = job.arkTaskId
    }

    const data = await queryVideoGenerationTask(arkTaskId)
    if (data.status === 'succeeded' && data.videoUrl) {
      // 机审：模型生成的视频过审后才允许展示给用户预览，未过审直接判定任务失败
      const outputAudit = await checkContent({
        kind: 'video',
        content: data.videoUrl,
        contentId: taskId,
        description: `${mode} 生成结果视频`,
      })
      if (!outputAudit.passed) {
        await reportTokenOutcomeIfNeeded(taskId, false, {})
        return response.json({
          taskId,
          status: 'failed',
          mode,
          message: '生成结果未通过内容审核，请调整素材后重新生成。',
          ...(templateTitle ? { templateTitle } : {}),
        })
      }

      const compliantVideoBuffer = await createCompliantVideoBuffer({
        sourceUrl: data.videoUrl,
        taskId,
      })
      try {
        const archived = await archiveGeneratedVideo({
          taskId,
          videoBuffer: compliantVideoBuffer,
          mode: String(mode),
          templateTitle: templateTitle || '',
        })
        data.videoUrl = archived.videoUrl
        data.posterUrl = archived.posterUrl || ''
      } catch (error) {
        console.warn('归档视频到 TOS 失败，回退本地缓存：', error)
        try {
          const cached = await cacheGeneratedVideo(compliantVideoBuffer, taskId, generatedVideosRoot)
          data.videoUrl = cached.videoUrl
          data.posterUrl = cached.posterUrl || ''
        } catch (cacheError) {
          throw new Error(
            `合规视频归档失败，未返回未标识的临时视频：${cacheError instanceof Error ? cacheError.message : String(cacheError)}`,
          )
        }
      }
      await reportTokenOutcomeIfNeeded(taskId, true, { videoUrl: data.videoUrl })
    } else if (data.status === 'failed') {
      await reportTokenOutcomeIfNeeded(taskId, false, {})
    }
    return response.json({ ...data, taskId, mode, ...(templateTitle ? { templateTitle } : {}) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to query task.'
    await reportTokenOutcomeIfNeeded(taskId, false, {})
    return response.status(500).json({
      taskId,
      status: 'failed',
      mode,
      message,
    })
  }
})

async function loadPosterSourceVideo(request, videoUrl) {
  const baseUrl = `${request.protocol}://${request.get('host') || 'localhost'}`
  const url = new URL(videoUrl, baseUrl)
  const isSameOrigin = !videoUrl.startsWith('http') || url.host === request.get('host')

  if (isSameOrigin && url.pathname.startsWith('/generated-videos/')) {
    const fileName = path.basename(decodeURIComponent(url.pathname))
    if (!generatedVideoNamePattern.test(fileName)) {
      throw new Error('本地视频文件名不正确。')
    }
    return readFile(path.join(generatedVideosRoot, fileName))
  }

  if (isSameOrigin && url.pathname.startsWith('/templates/')) {
    const fileName = path.basename(decodeURIComponent(url.pathname))
    if (!templateVideoNamePattern.test(fileName)) {
      throw new Error('模板视频文件名不正确。')
    }
    return readFile(path.join(__dirname, '..', 'public', 'templates', fileName))
  }

  if (!['http:', 'https:'].includes(url.protocol) || isBlockedPosterHost(url.hostname)) {
    throw new Error('只支持公网视频地址生成封面。')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  try {
    const videoResponse = await fetch(url, { signal: controller.signal })
    if (!videoResponse.ok) {
      throw new Error(`下载视频失败：HTTP ${videoResponse.status}`)
    }
    const contentLength = Number(videoResponse.headers.get('content-length') || 0)
    if (contentLength > maxPosterSourceBytes) {
      throw new Error('视频文件过大，无法生成封面。')
    }
    const body = Buffer.from(await videoResponse.arrayBuffer())
    if (body.byteLength > maxPosterSourceBytes) {
      throw new Error('视频文件过大，无法生成封面。')
    }
    return body
  } finally {
    clearTimeout(timeout)
  }
}

function isBlockedPosterHost(hostname) {
  const host = hostname.toLowerCase()
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) return true
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true
  const private172 = host.match(/^172\.(\d{1,2})\./)
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31)
}

// 上传的临时文件用完即删，避免 uploads 目录无限增长。
async function cleanupUpload(request) {
  if (!request.file?.path) return
  try {
    await unlink(request.file.path)
  } catch {
    // 文件可能已被 multer 清理，忽略
  }
}

// 统一的 JSON 错误响应，覆盖 multer 的文件大小/类型错误，避免返回 HTML 错误页。
app.use((error, request, response, _next) => {
  void cleanupUpload(request)
  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE' ? '图片超过 12MB 大小限制，请压缩后重试。' : `图片上传失败：${error.message}`
    return response.status(400).json({ status: 'failed', message })
  }
  const status = error?.statusCode || 500
  const message = error instanceof Error ? error.message : '服务内部错误。'
  console.error('未处理的服务错误：', error)
  response.status(status).json({ status: 'failed', message })
})

const port = Number(process.env.PORT || process.env.API_PORT || 8790)
app.listen(port, () => {
  console.log(`AI Yitu Zhenying API running at http://localhost:${port}`)
})
