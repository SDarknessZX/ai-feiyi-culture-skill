import cors from 'cors'
import './loadEnv.js'
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
import {
  checkContent,
  classifyStoredAudit,
  getContentAuditConfigReport,
  handleAuditCallback,
  isAuditServiceUnavailable,
} from './providers/contentAudit.js'
import {
  buildAigcLoginRedirectUrl,
  buildLoginRedirectUrl,
  buildPublishRedirectUrl,
  buildTaskIdRedirectUrl,
  buildUsageDetailUrl,
  cancelTokenTask,
  decryptMiguMsisdn,
  getMiguAigcConfigReport,
  getModelValueForMode,
  hasUsableTokenEntitlement,
  isTokenGatingEnabled,
  preDeductToken,
  queryTokenRemainCount,
  reportInteraction,
  reportTokenResult,
} from './providers/miguAigc.js'
import { getAliyunSmsConfigReport } from './providers/aliyunSms.js'
import { recordMiguTokenTask, updateMiguTokenSettlement, updateMiguTokenTaskState } from './providers/miguTaskStore.js'
import { cacheGeneratedVideo } from './providers/generatedVideoStorage.js'
import { archiveGeneratedVideo, ensureArchivedVideoPoster } from './providers/videoArchive.js'
import { createCompliantVideoBuffer, getVideoComplianceConfigReport } from './providers/videoCompliance.js'
import { createVideoPosterBuffer } from './providers/videoPoster.js'
import { getTosConfigReport, uploadFileToTos } from './providers/tosStorage.js'
import { detectFaces, getFaceDetectionConfigReport } from './providers/faceDetection.js'
import { assertImageHasVisibleContent } from './providers/imageValidation.js'
import { buildCostumeReferencePrompt, buildCostumeVideoPrompt, foodSystemPrompt } from './promptLibrary.js'
import { createCreationRateLimiter, getTrustProxyHops } from './middleware/createRateLimit.js'
import { loadStoredJobs, pruneStoredJobs, saveStoredJob } from './providers/jobStore.js'
import { findStoredAudit } from './providers/auditStore.js'
import { createConfiguredSmsAuthService, createUnavailableSmsAuthService } from './auth/configuredSmsAuth.js'
import { createSmsLoginRouter } from './auth/smsLoginRouter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const generatedVideosRoot = path.join(__dirname, '..', 'generated-videos')

const app = express()
const trustProxyHops = getTrustProxyHops()
if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops)
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

const publishVideoSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  videoCover: z.string().trim().min(1).max(2048),
  projectId: z.string().trim().max(256).optional(),
  releaseId: z.string().trim().max(256).optional(),
  watermarkId: z.string().trim().max(256).optional(),
  otherSet: z.string().trim().max(256).optional(),
  isMiniPublish: z.string().trim().max(32).optional(),
})

const taskIdPattern = /^[\w-]{1,128}$/
const generatedVideoNamePattern = /^[\w.-]+\.mp4$/i
const templateVideoNamePattern = /^[^\\/]+\.mp4$/i
const maxPosterSourceBytes = 60 * 1024 * 1024

// 创建任务改为异步：/api/create 立刻返回 job id，重活在后台跑，
// 避免公网隧道对长请求超时（serveo 等隧道等不到响应会回 502）。
const jobTtlMs = 7 * 24 * 60 * 60 * 1000
const jobs = new Map(loadStoredJobs(Date.now() - jobTtlMs))
const jobFinalizationPromises = new Map()
const preparationStartPromises = new Map()
const resumedJobIds = new Set()
let storedArkRefreshPromise = null

function registerJob(jobId, job) {
  const now = Date.now()
  const stored = { ...job, createdAt: Number(job.createdAt) || now, updatedAt: Number(job.updatedAt) || now }
  jobs.set(jobId, stored)
  saveStoredJob(jobId, stored)
  return stored
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId)
  if (!job) return
  const nextPatch = { ...patch }
  if (Number.isFinite(nextPatch.progress)) {
    nextPatch.progress = Math.max(Number(job.progress) || 0, Number(nextPatch.progress))
  }
  Object.assign(job, nextPatch, { updatedAt: Date.now() })
  saveStoredJob(jobId, job)
}

setInterval(() => {
  const now = Date.now()
  for (const [jobId, job] of jobs) {
    if (now - job.updatedAt > jobTtlMs) jobs.delete(jobId)
  }
  pruneStoredJobs(now - jobTtlMs)
}, 10 * 60 * 1000).unref()

async function runCreateJob({ jobId, mode, gender, style, file, imageUrl }) {
  try {
    updateJob(jobId, { status: 'running', progress: 28 })
    updateMiguTokenTaskState(jobId, 'running')

    if (mode === 'food') {
      updateJob(jobId, { message: '正在识别美食并生成专属提示词...', progress: 46 })
      const generatedPrompt = await generateFoodVideoPrompt({
        imageUrl,
        systemPrompt: foodSystemPrompt,
      })
      updateJob(jobId, { message: '正在提交视频生成任务...', progress: 72 })
      const task = await submitImageToVideoTask({ mode, imageUrl, prompt: generatedPrompt })
      updateJob(jobId, { arkTaskId: task.taskId, message: task.message, progress: 72 })
      return
    }

    if (mode === 'costume') {
      updateJob(jobId, { message: '正在生成换装参考图（约需 1 分钟）...', progress: 54 })
      const costumeReferenceImageUrl = await generateCostumeReferenceImage({
        sourceImageUrl: imageUrl,
        prompt: buildCostumeReferencePrompt(),
      })
      updateJob(jobId, {
        message: '参考图已生成，正在提交视频生成任务...',
        mediumResults: [{ contentType: 'image', content: costumeReferenceImageUrl }],
        progress: 68,
      })
      const task = await submitImageToVideoTask({
        mode,
        imageUrl: costumeReferenceImageUrl,
        prompt: buildCostumeVideoPrompt({ stylePrompt: style.prompt, gender }),
      })
      updateJob(jobId, { arkTaskId: task.taskId, message: task.message, progress: 72 })
      return
    }

    updateJob(jobId, { message: '正在提交视频生成任务...', progress: 72 })
    const task = await submitImageToVideoTask({ mode, imageUrl, prompt: style.prompt })
    updateJob(jobId, { arkTaskId: task.taskId, message: task.message, progress: 72 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '任务处理失败。'
    updateJob(jobId, {
      status: 'failed',
      message,
    })
    updateMiguTokenTaskState(jobId, 'failed', message)
    // 任务已经进入创作流程，最终失败也必须调用结果上报并传 result=false，返还预扣权益。
    await settleTokenOutcomeIfNeeded(jobId, 'failure', {})
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

function continueAwaitingInputAudit(jobId) {
  const job = jobs.get(jobId)
  if (!job || job.status !== 'awaiting_input_audit') return job

  const decision = classifyStoredAudit(findStoredAudit(job.auditDataId))
  if (decision.state === 'pending') return job
  if (decision.state === 'unavailable') {
    updateJob(jobId, {
      status: 'failed',
      progress: 100,
      code: 'CONTENT_AUDIT_TEMPORARILY_UNAVAILABLE',
      message: '内容审核服务处理失败，请稍后重试；本次并非判定为内容违规。',
    })
    return jobs.get(jobId)
  }
  if (decision.state === 'rejected') {
    updateJob(jobId, {
      status: 'failed',
      progress: 100,
      code: 'CONTENT_AUDIT_REJECTED',
      message: `图片未通过内容审核，请修改后重试（审核编号：${job.auditDataId}）`,
    })
    return jobs.get(jobId)
  }

  if (jobId.startsWith('prep-')) {
    updateJob(jobId, {
      status: 'prepared',
      progress: 100,
      auditDataId: '',
      code: '',
      message: '素材审核通过，可以继续创作。',
    })
    return jobs.get(jobId)
  }

  const styleCheck = resolveStyle(job.mode, job.templateId)
  if (styleCheck.error || !job.inputImageUrl) {
    updateJob(jobId, {
      status: 'failed',
      progress: 100,
      code: styleCheck.error?.code || 'CREATION_RESUME_FAILED',
      message: styleCheck.error?.message || '任务恢复失败：缺少原始素材地址。',
    })
    return jobs.get(jobId)
  }

  updateJob(jobId, {
    status: 'queued',
    progress: 18,
    auditDataId: '',
    code: '',
    message: '图片审核通过，正在准备素材...',
  })
  void runCreateJob({
    jobId,
    mode: job.mode,
    gender: job.gender,
    style: styleCheck.style,
    file: null,
    imageUrl: job.inputImageUrl,
  })
  return jobs.get(jobId)
}

function refreshAwaitingInputAudits() {
  for (const [jobId, job] of jobs) {
    if (job.status === 'awaiting_input_audit') continueAwaitingInputAudit(jobId)
  }
}

function resumeStoredJobs() {
  for (const [jobId, job] of jobs) {
    if (!['queued', 'running'].includes(job.status) || job.arkTaskId || resumedJobIds.has(jobId)) continue
    const styleCheck = resolveStyle(job.mode, job.templateId)
    if (styleCheck.error || !job.inputImageUrl) {
      updateJob(jobId, {
        status: 'failed',
        message: styleCheck.error?.message || '任务恢复失败：缺少原始素材地址。',
      })
      void settleTokenOutcomeIfNeeded(jobId, 'failure', {})
      continue
    }
    resumedJobIds.add(jobId)
    console.info('[job.resume]', JSON.stringify({ jobId, mode: job.mode, progress: job.progress }))
    void runCreateJob({
      jobId,
      mode: job.mode,
      gender: job.gender,
      style: styleCheck.style,
      file: null,
      imageUrl: job.inputImageUrl,
    })
  }
}

async function refreshStoredArkJobs() {
  const recoverable = [...jobs.entries()].filter(
    ([, job]) => ['queued', 'running'].includes(job.status) && Boolean(job.arkTaskId),
  )
  await Promise.allSettled(
    recoverable.map(async ([jobId, job]) => {
      const generated = await queryVideoGenerationTask(job.arkTaskId)
      if (generated.status === 'failed') {
        updateJob(jobId, { status: 'failed', message: generated.message })
        await settleTokenOutcomeIfNeeded(jobId, 'failure', {})
        return
      }
      if (generated.status !== 'succeeded' || !generated.videoUrl) return
      let finalization = jobFinalizationPromises.get(jobId)
      if (!finalization) {
        finalization = finalizeGeneratedVideo({
          taskId: jobId,
          mode: job.mode,
          templateTitle: job.templateTitle,
          generated,
        })
        jobFinalizationPromises.set(jobId, finalization)
      }
      try {
        await finalization
      } finally {
        if (jobFinalizationPromises.get(jobId) === finalization) jobFinalizationPromises.delete(jobId)
      }
    }),
  )
}

function scheduleStoredArkRefresh() {
  if (storedArkRefreshPromise) return storedArkRefreshPromise
  storedArkRefreshPromise = refreshStoredArkJobs().finally(() => {
    storedArkRefreshPromise = null
  })
  return storedArkRefreshPromise
}

setInterval(() => {
  void scheduleStoredArkRefresh()
}, 15_000).unref()

setInterval(() => {
  refreshAwaitingInputAudits()
}, 3_000).unref()

async function finalizeGeneratedVideo({ taskId, mode, templateTitle, generated }) {
  const data = { ...generated }
  const outputAudit = await checkContent({
    kind: 'video',
    content: data.videoUrl,
    contentId: taskId,
    description: `${mode} 生成结果视频`,
  })
  if (outputAudit.pending) {
    updateJob(taskId, {
      status: 'running',
      progress: 88,
      auditDataId: outputAudit.dataId,
      message: '视频已生成，正在等待内容审核结果...',
    })
    const error = new Error('视频已生成，正在等待内容审核结果。')
    error.code = 'CONTENT_AUDIT_PENDING'
    throw error
  }
  if (!outputAudit.passed) {
    if (isAuditServiceUnavailable(outputAudit)) {
      const error = new Error('视频已生成，正在等待内容审核服务恢复，请稍候。')
      error.code = 'CONTENT_AUDIT_TEMPORARILY_UNAVAILABLE'
      throw error
    }
    data.status = 'failed'
    data.videoUrl = ''
    data.message = '生成结果未通过内容审核，请调整素材后重新生成。'
    updateJob(taskId, { status: 'failed', message: data.message })
    await settleTokenOutcomeIfNeeded(taskId, 'failure', {})
    return data
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
  updateJob(taskId, { status: 'succeeded', resultVideoUrl: data.videoUrl, message: data.message })
  await settleTokenOutcomeIfNeeded(taskId, 'success', { videoUrl: data.videoUrl })
  return data
}

// 每个逻辑创作只在入口计数一次。Token 路径中的 /create/start 是 /create/prepare 的续接，
// 不能再次计数，否则 20 次限额实际只允许 10 次创作。
const rateLimitCreate = createCreationRateLimiter()

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

// Token 结算：创作成功/失败都走“使用结果上报”；只有用户主动取消或废弃任务才走“使用撤销”。
// 同一个 job 的并发轮询复用同一个 Promise；接口失败时恢复 pending，允许下次轮询重试。
async function settleTokenOutcomeIfNeeded(jobId, outcome, { inputImageUrl, videoUrl }) {
  const job = jobId.startsWith('job-') ? jobs.get(jobId) : null
  if (!job?.miguTaskId || job.tokenSettlementStatus === 'settled') return true
  if (job.tokenSettlementPromise) return job.tokenSettlementPromise

  const operation = (async () => {
    try {
      if (outcome === 'cancel') {
        await cancelTokenTask({ otoken: job.miguOtoken, taskId: job.miguTaskId })
      } else {
        const succeeded = outcome === 'success'
        await reportTokenResult({
          otoken: job.miguOtoken,
          taskId: job.miguTaskId,
          result: succeeded,
          inputContents: [{ contentType: 'image', content: inputImageUrl || job.inputImageUrl || '' }],
          ...(videoUrl ? { finalResults: [{ contentType: 'video', content: videoUrl }] } : {}),
          ...(job.mediumResults?.length ? { mediumResults: job.mediumResults } : {}),
        })
      }
      const settlementOutcome = outcome === 'cancel' ? 'cancelled' : outcome === 'success' ? 'reported_success' : 'reported_failure'
      updateJob(jobId, { tokenSettlementStatus: 'settled', tokenSettlementOutcome: settlementOutcome })
      updateMiguTokenSettlement(jobId, 'settled', settlementOutcome)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateJob(jobId, { tokenSettlementStatus: 'pending' })
      updateMiguTokenSettlement(jobId, 'pending', '', message)
      console.error(
        `[migu] Token ${outcome === 'cancel' ? '预扣撤销' : '使用结果上报'}失败（jobId=${jobId}, miguTaskId=${job.miguTaskId}），等待下次重试：`,
        error,
      )
      return false
    } finally {
      if (job.tokenSettlementPromise === operation) delete job.tokenSettlementPromise
    }
  })()

  updateJob(jobId, { tokenSettlementStatus: 'processing', tokenSettlementPromise: operation })
  return operation
}

function resumePendingSettlements() {
  for (const [jobId, job] of jobs) {
    if (!job.miguTaskId || job.tokenSettlementStatus === 'settled') continue
    if (!['succeeded', 'failed'].includes(job.status)) continue
    const outcome = job.status === 'succeeded' ? 'success' : 'failure'
    console.info('[migu.settlement.resume]', JSON.stringify({ jobId, outcome }))
    void settleTokenOutcomeIfNeeded(jobId, outcome, {
      inputImageUrl: job.inputImageUrl,
      videoUrl: job.resultVideoUrl,
    })
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

const configuredCorsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
if (configuredCorsOrigins.length) app.use(cors({ origin: configuredCorsOrigins }))
else if (process.env.NODE_ENV !== 'production') app.use(cors())
app.use(express.json())
app.use((request, response, next) => {
  const requestId = String(request.headers['x-request-id'] || '').trim().slice(0, 128) || crypto.randomUUID()
  request.requestId = requestId
  response.set({
    'X-Request-Id': requestId,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  })
  const sendJson = response.json.bind(response)
  response.json = (body) => {
    const safeBody =
      response.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)
        ? { ...body, requestId }
        : body
    if (response.statusCode === 422 && request.path.startsWith('/api/create')) {
      console.warn(
        '[create.validation]',
        JSON.stringify({
          requestId,
          route: request.path,
          status: response.statusCode,
          code: safeBody?.code || 'CREATE_VALIDATION_REJECTED',
          mode: safeBody?.mode || request.body?.mode || '',
          auditId: safeBody?.auditId || '',
        }),
      )
    }
    return sendJson(safeBody)
  }
  next()
})
const smsAuthConfig = getAliyunSmsConfigReport()
const smsAuthRuntime = smsAuthConfig.configured
  ? createConfiguredSmsAuthService()
  : { service: createUnavailableSmsAuthService(), close: () => {} }
app.use('/api/auth/sms', createSmsLoginRouter({ service: smsAuthRuntime.service }))
app.use(
  '/templates',
  express.static(path.join(__dirname, '..', 'public', 'templates'), {
    acceptRanges: true,
    setHeaders: (response, filePath) => {
      if (path.extname(filePath).toLowerCase() === '.mp4') {
        response.setHeader('Content-Type', 'video/mp4')
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  }),
)
app.use(
  '/generated-videos',
  express.static(generatedVideosRoot, {
    setHeaders: (response, filePath) => {
      // 咪咕彩铃发布页明确要求 mp4 地址响应 Content-Type 为 video/mp4。
      if (path.extname(filePath).toLowerCase() === '.mp4') response.setHeader('Content-Type', 'video/mp4')
    },
  }),
)
// 公网访问直接走这里的生产构建（npm run build 产物），比 vite 开发模式快得多
app.use(express.static(path.join(__dirname, '..', 'dist')))

app.get('/api/health', (_request, response) => {
  const config = getProviderConfigReport()
  const compliance = getVideoComplianceConfigReport()
  const faceDetection = getFaceDetectionConfigReport()
  const tos = getTosConfigReport()
  const contentAudit = getContentAuditConfigReport()
  const miguAigc = getMiguAigcConfigReport()
  const smsAuth = getAliyunSmsConfigReport()
  const readinessIssues = []
  if (process.env.NODE_ENV === 'production') {
    if (config.provider !== 'ark' || !config.arkConfigured) readinessIssues.push('Ark 视频生成配置不完整')
    if (!tos.configured) readinessIssues.push('TOS 持久化存储配置不完整')
    if (!compliance.watermarkAssetConfigured) readinessIssues.push('AI 合规水印资源缺失')
    if (!faceDetection.enabled) readinessIssues.push('人脸检测服务不可用')
    if (!contentAudit.configured) readinessIssues.push('内容审核服务配置不完整')
    if (
      process.env.VITE_BYPASS_MIGU_LOGIN !== 'true' &&
      (!miguAigc.configured || !miguAigc.channelLoginConfigured)
    ) {
      readinessIssues.push('咪咕登录配置不完整')
    }
    if (process.env.VITE_BYPASS_MIGU_LOGIN !== 'true' && !smsAuth.configured) {
      readinessIssues.push('阿里云短信登录配置不完整')
    }
    if (process.env.MIGU_TOKEN_GATING_ENABLED === 'true' && !miguAigc.tokenGatingEnabled) {
      readinessIssues.push('咪咕 Token 网关已要求启用，但配置不完整')
    }
  }
  response.status(readinessIssues.length ? 503 : 200).json({
    ok: readinessIssues.length === 0,
    provider: config.provider,
    readinessIssues,
    config: {
      ...config,
      compliance,
      faceDetection,
      tos,
      contentAudit,
      miguAigc,
      smsAuth,
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
app.get('/api/migu/login-redirect', async (_request, response) => {
  response.set('Cache-Control', 'no-store')
  try {
    const url = await buildLoginRedirectUrl()
    response.redirect(302, url)
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : '无法跳转到咪咕登录。')
  }
})
app.post('/api/migu/aigc-login-url', (request, response) => {
  const token = String(request.body?.token || '').trim()
  if (!token || token.length > 2048) {
    return response.status(400).json({ message: '咪咕登录回调 token 缺失或格式不正确。' })
  }
  try {
    response.json({ url: buildAigcLoginRedirectUrl(token) })
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : '无法继续咪咕登录。' })
  }
})
app.post('/api/migu/publish-url', async (request, response) => {
  const parsed = publishVideoSchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ message: '缺少可发布的视频或封面地址。' })
  }
  try {
    const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    const protocol = forwardedProto || request.protocol
    const origin = `${protocol}://${request.get('host') || 'localhost'}`
    const videoUrl = new URL(parsed.data.videoUrl, origin)
    const videoCover = new URL(parsed.data.videoCover, origin)
    if (!['http:', 'https:'].includes(videoUrl.protocol) || !['http:', 'https:'].includes(videoCover.protocol)) {
      return response.status(400).json({ message: '视频或封面地址格式不正确。' })
    }
    const url = await buildPublishRedirectUrl({
      videoUrl: videoUrl.toString(),
      videoCover: videoCover.toString(),
      projectId: parsed.data.projectId,
      releaseId: parsed.data.releaseId,
      watermarkId: parsed.data.watermarkId,
      otherSet: parsed.data.otherSet,
      isMiniPublish: parsed.data.isMiniPublish,
    })
    response.json({ url })
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : '无法生成视频彩铃发布地址。' })
  }
})
app.post('/api/migu/usage-detail-url', (request, response) => {
  const token = String(request.body?.token || '').trim()
  const cfrom = request.body?.cfrom ? String(request.body.cfrom).trim() : undefined
  try {
    const url = buildUsageDetailUrl({ token, cfrom })
    response.json({ url })
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : '无法生成分贝明细页地址。' })
  }
})
app.get('/api/migu/token-gating', (_request, response) => {
  response.set('Cache-Control', 'no-store')
  response.json({ enabled: isTokenGatingEnabled() })
})
app.post('/api/migu/task-id-url', async (request, response) => {
  const btoken = String(request.body?.btoken || '').trim()
  const mode = String(request.body?.mode || '').trim()
  const modelValue = getModelValueForMode(mode)
  if (!btoken) {
    return response.status(401).json({ message: '缺少 btoken，请先完成登录。' })
  }
  if (!modelValue) {
    return response.status(400).json({ message: `不支持的玩法模态：${mode || '（空）'}` })
  }
  try {
    // 文档要求拉起 taskId 页面之前必须先查询权益；查询异常或无可用权益一律不放行。
    const tokenRemain = await queryTokenRemainCount({ otoken: btoken, modelValue })
    if (!hasUsableTokenEntitlement(tokenRemain)) {
      return response.status(402).json({ message: '当前没有可用的 AI 创作权益，请先开通或领取权益。', tokenRemain })
    }
    const url = buildTaskIdRedirectUrl({ btoken, modelValue, contentType: 'video' })
    response.json({ url, tokenRemain })
  } catch (error) {
    console.error(`[migu] task-id 权益预检失败（mode=${mode}, code=${error?.code || 'UNKNOWN'}）：`, error?.message || error)
    response.status(502).json({ message: error instanceof Error ? error.message : 'Token 权益查询失败，无法获取 taskId。' })
  }
})
app.post('/api/migu/token/remain', async (request, response) => {
  const otoken = String(request.body?.otoken || '').trim()
  const mode = String(request.body?.mode || '').trim()
  const modelValue = getModelValueForMode(mode)
  if (!modelValue) {
    return response.status(400).json({ message: `不支持的玩法模态：${mode || '（空）'}` })
  }
  try {
    const data = await queryTokenRemainCount({ otoken, modelValue })
    response.json(data)
  } catch (error) {
    console.error(`[migu] Token 余量查询失败（mode=${mode}, code=${error?.code || 'UNKNOWN'}）：`, error?.message || error)
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
  const results = Array.isArray(request.body) ? request.body : request.body ? [request.body] : []
  const matched = handleAuditCallback(request.body)
  console.info(
    '[contentAudit.callback]',
    JSON.stringify({
      requestId: request.requestId,
      count: results.length,
      matched,
      results: results.map((item) => ({
        dataId: item?.dataId || '',
        status: item?.status || '',
        label: item?.label || '',
        dataType: item?.dataType || '',
      })),
    }),
  )

  response.json({
    code: '000000',
    info: 'success',
  })
})
app.get('/api/templates', (_request, response) => {
  response.set('Cache-Control', 'no-store')
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

  try {
    await assertImageHasVisibleContent(request.file.path)
  } catch (error) {
    await cleanupUpload(request)
    return response.status(422).json({
      status: 'failed',
      code: error?.code || 'INVALID_IMAGE_CONTENT',
      mode: input.mode,
      message: error instanceof Error ? error.message : '图片内容无法识别，请重新上传。',
    })
  }
  const imageFingerprint = crypto.createHash('sha256').update(await readFile(request.file.path)).digest('hex')

  if (input.mode === 'costume') {
    try {
      const faceResult = await detectFaces(request.file)
      if (!faceResult.hasFace) {
        await cleanupUpload(request)
        return response.status(422).json({
          status: 'failed',
          code: 'FACE_NOT_DETECTED',
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
  const inputAuditContentId = `input-${imageFingerprint.slice(0, 32)}`
  const inputAudit = await checkContent({
    kind: 'picture',
    content: imageUrl,
    contentId: inputAuditContentId,
    description: `${input.mode} 创作输入图片`,
  })
  if (inputAudit.pending) {
    registerJob(jobId, {
      status: 'awaiting_input_audit',
      progress: 18,
      mode: input.mode,
      templateTitle: styleCheck.templateTitle,
      templateId: input.template,
      gender: input.gender,
      arkTaskId: '',
      auditDataId: inputAudit.dataId,
      message: '图片已提交审核，审核通过后将自动继续创作。',
      inputImageUrl: imageUrl,
      updatedAt: Date.now(),
    })
    await cleanupUpload(request)
    return response.status(202).json({
      taskId: jobId,
      status: 'running',
      progress: 18,
      code: 'CONTENT_AUDIT_PENDING',
      auditId: inputAudit.dataId,
      mode: input.mode,
      templateTitle: styleCheck.templateTitle,
      inputImageUrl: imageUrl,
      message: '图片已提交审核，审核通过后将自动继续创作。',
    })
  }
  if (!inputAudit.passed) {
    await cleanupUpload(request)
    if (isAuditServiceUnavailable(inputAudit)) {
      return response.status(503).json({
        status: 'failed',
        code: 'CONTENT_AUDIT_TEMPORARILY_UNAVAILABLE',
        mode: input.mode,
        message: '内容审核服务暂时不可用，请稍后重试；本次并非判定为内容违规。',
      })
    }
    const auditId = inputAudit.dataId || ''
    return response.status(422).json({
      status: 'failed',
      code: 'CONTENT_AUDIT_REJECTED',
      ...(auditId ? { auditId } : {}),
      mode: input.mode,
      message: `图片未通过内容审核，请修改后重试${auditId ? `（审核编号：${auditId}）` : ''}`,
    })
  }

  registerJob(jobId, {
    status: 'queued',
    progress: 18,
    mode: input.mode,
    templateTitle: styleCheck.templateTitle,
    arkTaskId: '',
    message: '任务已受理，正在准备素材...',
    updatedAt: Date.now(),
    inputImageUrl: imageUrl,
    templateId: input.template,
    gender: input.gender,
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
    progress: 18,
    mode: input.mode,
    templateTitle: styleCheck.templateTitle,
    inputImageUrl: imageUrl,
    message: '任务已受理，正在后台处理，请稍候。',
  })
})

// Token 计费网关开启时的创作流程分两步：
// 1) /api/create/prepare 先做人脸检测/模板校验/上传/输入机审，并持久化 preparationId；刷新后仍可恢复
// 2) 跳转回来后调 /api/create/start，仅凭服务端 preparationId 取已过审素材，Token 预扣通过后才真正建任务
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

  try {
    await assertImageHasVisibleContent(request.file.path)
  } catch (error) {
    await cleanupUpload(request)
    return response.status(422).json({
      status: 'failed',
      code: error?.code || 'INVALID_IMAGE_CONTENT',
      mode: input.mode,
      message: error instanceof Error ? error.message : '图片内容无法识别，请重新上传。',
    })
  }
  const imageFingerprint = crypto.createHash('sha256').update(await readFile(request.file.path)).digest('hex')

  if (input.mode === 'costume') {
    try {
      const faceResult = await detectFaces(request.file)
      if (!faceResult.hasFace) {
        await cleanupUpload(request)
        return response.status(422).json({
          status: 'failed',
          code: 'FACE_NOT_DETECTED',
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

  const preparationId = `prep-${crypto.randomUUID()}`
  const inputAuditContentId = `input-${imageFingerprint.slice(0, 32)}`
  const inputAudit = await checkContent({
    kind: 'picture',
    content: imageUrl,
    contentId: inputAuditContentId,
    description: `${input.mode} 创作输入图片`,
  })
  if (inputAudit.pending) {
    registerJob(preparationId, {
      status: 'awaiting_input_audit',
      progress: 18,
      mode: input.mode,
      templateTitle: styleCheck.templateTitle,
      templateId: input.template,
      gender: input.gender,
      arkTaskId: '',
      auditDataId: inputAudit.dataId,
      message: '图片已提交审核，审核通过后将自动继续。',
      inputImageUrl: imageUrl,
      updatedAt: Date.now(),
    })
    return response.status(202).json({
      preparationId,
      status: 'running',
      progress: 18,
      code: 'CONTENT_AUDIT_PENDING',
      auditId: inputAudit.dataId,
      mode: input.mode,
      template: input.template,
      gender: input.gender,
      templateTitle: styleCheck.templateTitle,
      imageUrl,
      message: '图片已提交审核，审核通过后将自动继续。',
    })
  }
  if (!inputAudit.passed) {
    if (isAuditServiceUnavailable(inputAudit)) {
      return response.status(503).json({
        status: 'failed',
        code: 'CONTENT_AUDIT_TEMPORARILY_UNAVAILABLE',
        mode: input.mode,
        message: '内容审核服务暂时不可用，请稍后重试；本次并非判定为内容违规。',
      })
    }
    const auditId = inputAudit.dataId || ''
    return response.status(422).json({
      status: 'failed',
      code: 'CONTENT_AUDIT_REJECTED',
      ...(auditId ? { auditId } : {}),
      mode: input.mode,
      message: `图片未通过内容审核，请修改后重试${auditId ? `（审核编号：${auditId}）` : ''}`,
    })
  }

  registerJob(preparationId, {
    status: 'prepared',
    progress: 100,
    mode: input.mode,
    templateTitle: styleCheck.templateTitle,
    templateId: input.template,
    gender: input.gender,
    arkTaskId: '',
    auditDataId: '',
    message: '素材审核通过，可以继续创作。',
    inputImageUrl: imageUrl,
    updatedAt: Date.now(),
  })
  return response.json({
    preparationId,
    status: 'ready',
    mode: input.mode,
    template: input.template,
    gender: input.gender,
    templateTitle: styleCheck.templateTitle,
    imageUrl,
  })
})

app.get('/api/create/prepare/:preparationId', (request, response) => {
  response.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  })
  const preparationId = String(request.params.preparationId || '')
  if (!/^prep-[\w-]{1,128}$/.test(preparationId)) {
    return response.status(400).json({ status: 'failed', code: 'INVALID_PREPARATION_ID', message: '素材准备编号格式不正确。' })
  }

  let preparation = jobs.get(preparationId)
  if (!preparation) {
    return response.status(404).json({ status: 'failed', code: 'PREPARATION_NOT_FOUND', message: '素材准备记录不存在或已过期，请重新上传。' })
  }
  if (preparation.status === 'awaiting_input_audit') {
    preparation = continueAwaitingInputAudit(preparationId) || preparation
  }
  if (preparation.status === 'awaiting_input_audit') {
    return response.status(202).json({
      preparationId,
      status: 'running',
      progress: preparation.progress,
      code: 'CONTENT_AUDIT_PENDING',
      auditId: preparation.auditDataId,
      mode: preparation.mode,
      template: preparation.templateId,
      gender: preparation.gender,
      templateTitle: preparation.templateTitle,
      imageUrl: preparation.inputImageUrl,
      message: preparation.message,
    })
  }
  if (preparation.status === 'failed') {
    const statusCode = preparation.code === 'CONTENT_AUDIT_TEMPORARILY_UNAVAILABLE' ? 503 : 422
    return response.status(statusCode).json({
      preparationId,
      status: 'failed',
      code: preparation.code,
      mode: preparation.mode,
      message: preparation.message,
    })
  }
  if (!['prepared', 'started'].includes(preparation.status) || !preparation.inputImageUrl) {
    return response.status(409).json({ status: 'failed', code: 'PREPARATION_NOT_READY', message: '素材尚未准备完成，请稍后重试。' })
  }

  return response.json({
    preparationId,
    status: 'ready',
    mode: preparation.mode,
    template: preparation.templateId,
    gender: preparation.gender,
    templateTitle: preparation.templateTitle,
    imageUrl: preparation.inputImageUrl,
  })
})

const createStartSchema = z.object({
  preparationId: z.string().trim().regex(/^prep-[\w-]{1,128}$/),
  taskId: z.string().trim().min(1).max(128),
  otoken: z.string().trim().min(1).max(256),
})

app.post('/api/create/start', async (request, response) => {
  const parsed = createStartSchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ status: 'failed', message: '请求参数不正确。' })
  }
  const input = parsed.data
  let startPromise = preparationStartPromises.get(input.preparationId)
  if (!startPromise) {
    startPromise = startPreparedCreation(input)
    preparationStartPromises.set(input.preparationId, startPromise)
  }
  try {
    const outcome = await startPromise
    return response.status(outcome.statusCode).json(outcome.body)
  } finally {
    if (preparationStartPromises.get(input.preparationId) === startPromise) preparationStartPromises.delete(input.preparationId)
  }
})

async function startPreparedCreation(input) {
  const preparation = jobs.get(input.preparationId)
  if (!preparation) {
    return { statusCode: 404, body: { status: 'failed', code: 'PREPARATION_NOT_FOUND', message: '素材准备记录不存在或已过期，请重新上传。' } }
  }
  if (preparation.status === 'awaiting_input_audit') {
    continueAwaitingInputAudit(input.preparationId)
  }
  const currentPreparation = jobs.get(input.preparationId)
  if (currentPreparation?.status === 'started' && currentPreparation.linkedJobId) {
    const existingJob = jobs.get(currentPreparation.linkedJobId)
    if (existingJob) {
      return {
        statusCode: 200,
        body: {
          taskId: currentPreparation.linkedJobId,
          // 已完成任务也先按 running 返回，让前端统一查询 /api/tasks 并拿到归档视频和封面。
          status: existingJob.status === 'failed' ? 'failed' : 'running',
          progress: existingJob.progress,
          ...(existingJob.code ? { code: existingJob.code } : {}),
          mode: existingJob.mode,
          templateTitle: existingJob.templateTitle,
          inputImageUrl: existingJob.inputImageUrl,
          message: existingJob.message,
        },
      }
    }
  }
  if (currentPreparation?.status !== 'prepared' || !currentPreparation.inputImageUrl) {
    const failed = currentPreparation?.status === 'failed'
    return {
      statusCode: failed ? (currentPreparation.code === 'CONTENT_AUDIT_TEMPORARILY_UNAVAILABLE' ? 503 : 422) : 409,
      body: {
        status: 'failed',
        code: currentPreparation?.code || 'PREPARATION_NOT_READY',
        mode: currentPreparation?.mode,
        message: currentPreparation?.message || '素材尚未准备完成，请稍后重试。',
      },
    }
  }

  const styleCheck = resolveStyle(currentPreparation.mode, currentPreparation.templateId)
  if (styleCheck.error) {
    return { statusCode: styleCheck.status, body: { status: 'failed', mode: currentPreparation.mode, ...styleCheck.error } }
  }
  const modelValue = getModelValueForMode(currentPreparation.mode)
  if (!modelValue) {
    return {
      statusCode: 500,
      body: { status: 'failed', mode: currentPreparation.mode, message: `未配置「${currentPreparation.mode}」对应的咪咕模态值（modelValue），请检查 .env。` },
    }
  }

  const jobId = `job-${crypto.randomUUID()}`
  recordMiguTokenTask({ jobId, miguTaskId: input.taskId, mode: currentPreparation.mode })
  try {
    await preDeductToken({ otoken: input.otoken, taskId: input.taskId, contentType: 'video', modelValue })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token 权益不足或校验失败，请稍后重试。'
    updateMiguTokenTaskState(jobId, 'reduce_failed', message)
    return {
      statusCode: 402,
      body: { status: 'failed', code: error?.code || 'TOKEN_PREDEDUCT_FAILED', mode: currentPreparation.mode, message },
    }
  }

  updateMiguTokenTaskState(jobId, 'pre_deducted')
  updateMiguTokenSettlement(jobId, 'pending')
  registerJob(jobId, {
    status: 'queued',
    progress: 18,
    mode: currentPreparation.mode,
    templateTitle: currentPreparation.templateTitle || styleCheck.templateTitle,
    arkTaskId: '',
    message: '任务已受理，正在准备素材...',
    updatedAt: Date.now(),
    inputImageUrl: currentPreparation.inputImageUrl,
    templateId: currentPreparation.templateId,
    gender: currentPreparation.gender,
    miguTaskId: input.taskId,
    miguOtoken: input.otoken,
    tokenSettlementStatus: 'pending',
  })
  updateJob(input.preparationId, { status: 'started', linkedJobId: jobId, message: '创作任务已创建。' })
  void runCreateJob({
    jobId,
    mode: currentPreparation.mode,
    gender: currentPreparation.gender,
    style: styleCheck.style,
    file: null,
    imageUrl: currentPreparation.inputImageUrl,
  })

  return {
    statusCode: 200,
    body: {
      taskId: jobId,
      status: 'queued',
      progress: 18,
      mode: currentPreparation.mode,
      templateTitle: currentPreparation.templateTitle || styleCheck.templateTitle,
      inputImageUrl: currentPreparation.inputImageUrl,
      message: '任务已受理，正在后台处理，请稍候。',
    },
  }
}

app.get('/api/tasks/:taskId', async (request, response) => {
  response.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  })
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
      // 首次成功上报若遇到临时网络错误，后续查询归档作品时继续补报。
      await settleTokenOutcomeIfNeeded(taskId, 'success', { videoUrl: archived.videoUrl })
      return response.json({
        taskId,
        status: 'succeeded',
        progress: 100,
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
      let job = jobs.get(taskId)
      if (!job) {
        return response.json({
          taskId,
          status: 'failed',
          mode,
          message: '任务记录已丢失（服务可能重启过），请重新生成。',
        })
      }
      templateTitle = job.templateTitle
      if (job.status === 'awaiting_input_audit') {
        job = continueAwaitingInputAudit(taskId) || job
        if (job.status === 'awaiting_input_audit') {
          return response.json({
            taskId,
            status: 'running',
            progress: job.progress,
            code: 'CONTENT_AUDIT_PENDING',
            auditId: job.auditDataId,
            mode: job.mode,
            templateTitle,
            inputImageUrl: job.inputImageUrl,
            message: job.message,
          })
        }
      }
      if (job.auditDataId) {
        const auditDecision = classifyStoredAudit(findStoredAudit(job.auditDataId))
        if (auditDecision.state !== 'pending') {
          updateJob(taskId, { auditDataId: '' })
        } else {
          return response.json({
            taskId,
            status: 'running',
            progress: Math.max(Number(job.progress) || 0, 88),
            mode: job.mode,
            templateTitle,
            message: '视频已生成，正在等待内容审核结果...',
          })
        }
      }
      if (!job.arkTaskId) {
        if (job.status === 'failed') await settleTokenOutcomeIfNeeded(taskId, 'failure', {})
        return response.json({
          taskId,
          status: job.status === 'failed' ? 'failed' : 'running',
          progress: job.status === 'failed' ? 100 : job.progress,
          ...(job.code ? { code: job.code } : {}),
          mode: job.mode,
          templateTitle,
          inputImageUrl: job.inputImageUrl,
          message: job.message,
        })
      }
      arkTaskId = job.arkTaskId
    }

    let data = await queryVideoGenerationTask(arkTaskId)
    const job = taskId.startsWith('job-') ? jobs.get(taskId) : null
    if (job && data.status !== 'succeeded' && data.status !== 'failed') {
      data.progress = Math.max(Number(job.progress) || 0, Number(data.progress) || 0)
    }
    if (data.status === 'succeeded' && data.videoUrl) {
      // 同一任务可能被页面恢复、前台轮询等同时查询。机审、水印、归档必须只执行一次，
      // 其余请求共享同一个 Promise，避免同一个火山结果被重复送审和重复落库展示。
      updateJob(taskId, { progress: 86 })
      let finalization = jobFinalizationPromises.get(taskId)
      if (!finalization) {
        finalization = finalizeGeneratedVideo({ taskId, mode, templateTitle, generated: data })
        jobFinalizationPromises.set(taskId, finalization)
      }
      try {
        data = await finalization
      } finally {
        if (jobFinalizationPromises.get(taskId) === finalization) jobFinalizationPromises.delete(taskId)
      }
    } else if (data.status === 'failed') {
      updateJob(taskId, { status: 'failed', message: data.message })
      await settleTokenOutcomeIfNeeded(taskId, 'failure', {})
    }
    return response.json({ ...data, taskId, mode, ...(templateTitle ? { templateTitle } : {}) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to query task.'
    // 查询 Ark、下载结果、机审或归档都可能短暂失败。此时模型任务并没有给出终态，
    // 不能误上报 result=false，否则会提前关闭计费任务并造成下一次创作状态错乱。
    console.error(`查询或处理任务暂时失败（taskId=${taskId}）：`, error)
    return response.status(503).json({
      taskId,
      status: 'running',
      code: error?.code || 'TASK_STATUS_TEMPORARILY_UNAVAILABLE',
      mode,
      message: `任务仍在处理中，状态查询暂时失败，将自动重试。${message ? `（${message}）` : ''}`,
    })
  }
})

app.get('/api/audits/:dataId', (request, response) => {
  const dataId = String(request.params.dataId || '')
  if (!/^[\w-]{1,128}$/.test(dataId)) {
    return response.status(400).json({ status: 'failed', message: '审核编号格式不正确。' })
  }
  const audit = findStoredAudit(dataId)
  if (!audit) return response.status(404).json({ status: 'failed', message: '未找到审核记录。' })
  const decision = classifyStoredAudit(audit)
  const terminal = decision.state !== 'pending'
  return response.json({
    status: terminal ? 'completed' : 'running',
    auditId: dataId,
    label: decision.label,
    passed: terminal ? decision.state === 'passed' : undefined,
    unavailable: terminal ? decision.state === 'unavailable' : undefined,
  })
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

  if (isSameOrigin) {
    throw new Error('只支持本站已生成的视频或模板视频生成封面。')
  }

  if (!['http:', 'https:'].includes(url.protocol) || !isAllowedPosterHost(url.hostname)) {
    throw new Error('只支持本站已归档的视频地址生成封面。')
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

function isAllowedPosterHost(hostname) {
  const publicBaseUrl = process.env.TOS_PUBLIC_BASE_URL?.trim()
  if (!publicBaseUrl) return false
  try {
    return hostname.toLowerCase() === new URL(publicBaseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
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
  if (error?.status === 416 || error?.statusCode === 416) {
    return response.status(416).json({
      status: 'failed',
      code: 'VIDEO_RANGE_NOT_SATISFIABLE',
      message: '视频缓存版本已更新，请刷新页面后重试。',
    })
  }
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
const httpServer = app.listen(port, () => {
  console.log(`AI Yitu Zhenying API running at http://localhost:${port}`)
  resumeStoredJobs()
  refreshAwaitingInputAudits()
  resumePendingSettlements()
  void scheduleStoredArkRefresh()
})

let shuttingDown = false
async function shutdownGracefully(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`收到 ${signal}，停止接收新请求并收尾未结算的咪咕任务...`)
  httpServer.close()

  const settlements = []
  for (const [jobId, job] of jobs) {
    if (!job.miguTaskId || job.tokenSettlementStatus === 'settled') continue
    // 生成中的任务已经持久化，进程退出时不能误报失败；新进程会继续查询火山并最终结算。
    if (!['succeeded', 'failed'].includes(job.status)) continue
    const outcome = job.status === 'succeeded' ? 'success' : 'failure'
    settlements.push(settleTokenOutcomeIfNeeded(jobId, outcome, { videoUrl: job.resultVideoUrl }))
  }

  const timeout = new Promise((resolve) => setTimeout(resolve, 10_000))
  await Promise.race([Promise.allSettled(settlements), timeout])
  process.exit(0)
}

process.once('SIGTERM', () => void shutdownGracefully('SIGTERM'))
process.once('SIGINT', () => void shutdownGracefully('SIGINT'))
