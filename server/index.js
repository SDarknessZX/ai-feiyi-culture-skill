import cors from 'cors'
import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import { unlink } from 'node:fs/promises'
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
import { cacheGeneratedVideo } from './providers/generatedVideoStorage.js'
import { archiveGeneratedVideo, ensureArchivedVideoPoster } from './providers/videoArchive.js'
import { getTosConfigReport, uploadFileToTos } from './providers/tosStorage.js'
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

const taskIdPattern = /^[\w-]{1,128}$/

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

async function runCreateJob({ jobId, mode, gender, style, file }) {
  try {
    updateJob(jobId, { status: 'running', message: '正在上传图片素材...' })
    const imageUrl = await uploadFileToTos(file)

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
      tos: getTosConfigReport(),
    },
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

  let style = null
  let templateTitle = 'AI识别美食'

  if (input.mode === 'costume') {
    style = findCostumeStyle(input.template)
    if (!style) {
      await cleanupUpload(request)
      return response.status(404).json({
        status: 'failed',
        mode: input.mode,
        message: '未找到所选服饰模板，请刷新页面后重新选择。',
      })
    }
    if (!style.prompt) {
      await cleanupUpload(request)
      return response.status(400).json({
        status: 'failed',
        mode: input.mode,
        templateTitle: style.title,
        message: `“${style.title}”暂未配置生成提示词，请先选择已有提示词的服饰模板。`,
      })
    }
    templateTitle = style.title
  }

  if (input.mode === 'painting') {
    style = findPaintingStyle(input.template)
    if (!style) {
      await cleanupUpload(request)
      return response.status(404).json({
        status: 'failed',
        mode: input.mode,
        message: '未找到所选画作模板，请刷新页面后重新选择。',
      })
    }
    if (!style.prompt) {
      await cleanupUpload(request)
      return response.status(400).json({
        status: 'failed',
        mode: input.mode,
        templateTitle: style.title,
        message: `“${style.title}”暂未配置生成提示词，请检查 prompts/painting/paint.txt。`,
      })
    }
    templateTitle = style.title
  }

  const jobId = `job-${crypto.randomUUID()}`
  jobs.set(jobId, {
    status: 'queued',
    mode: input.mode,
    templateTitle,
    arkTaskId: '',
    message: '任务已受理，正在准备素材...',
    updatedAt: Date.now(),
  })
  // 上传的临时文件交给后台任务用完再删，这里不能先清理
  void runCreateJob({
    jobId,
    mode: input.mode,
    gender: input.gender,
    style,
    file: request.file,
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
      try {
        const archived = await archiveGeneratedVideo({
          taskId,
          sourceUrl: data.videoUrl,
          mode: String(mode),
          templateTitle: templateTitle || '',
        })
        data.videoUrl = archived.videoUrl
        data.posterUrl = archived.posterUrl || ''
      } catch (error) {
        console.warn('归档视频到 TOS 失败，回退本地缓存：', error)
        try {
          const cached = await cacheGeneratedVideo(data.videoUrl, taskId, generatedVideosRoot)
          data.videoUrl = cached.videoUrl
          data.posterUrl = cached.posterUrl || ''
        } catch (cacheError) {
          console.warn('本地缓存也失败，本次返回临时链接：', cacheError)
        }
      }
    }
    return response.json({ ...data, taskId, mode, ...(templateTitle ? { templateTitle } : {}) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to query task.'
    return response.status(500).json({
      taskId,
      status: 'failed',
      mode,
      message,
    })
  }
})

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
