import ffmpeg from '@ffmpeg-installer/ffmpeg'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const watermarkPath = path.join(__dirname, '..', 'assets', 'migu-ai-watermark.png')
const defaultContentProducer = '001191510100321561677C00000'
const maxSourceVideoBytes = 250 * 1024 * 1024
const watermarkFlag = '3'

export function getVideoComplianceConfigReport() {
  return {
    contentProducer: getContentProducer(),
    metadataFields: ['AIGC', 'WATERMARKFLAG'],
    watermarkAssetConfigured: existsSync(watermarkPath),
    watermarkFlag,
    watermarkVariant: 'migu-integrated',
  }
}

export function buildAigcMetadata(taskId) {
  const contentProducer = getContentProducer()
  const integrityCode1 = createIntegrityCode('produce', taskId, contentProducer)
  const integrityCode2 = createIntegrityCode('propagate', taskId, contentProducer)

  return {
    Label: '1',
    ContentProducer: contentProducer,
    ProduceID: taskId,
    ReservedCode1: integrityCode1,
    // 本应用发布的是首次生成内容，传播者编号按规范与生产者编号保持一致。
    ContentPropagator: contentProducer,
    PropagateID: taskId,
    ReservedCode2: integrityCode2,
  }
}

export async function createCompliantVideoBuffer({ sourceUrl, videoBuffer, taskId }) {
  if (!taskId) {
    throw new Error('缺少任务 ID，无法写入 AI 生成内容标识。')
  }

  const sourceBody = videoBuffer || (await downloadSourceVideo(sourceUrl))
  if (!sourceBody?.length) {
    throw new Error('生成视频内容为空，无法添加 AI 生成标识。')
  }

  return addComplianceToVideoBuffer(sourceBody, taskId)
}

async function addComplianceToVideoBuffer(videoBuffer, taskId) {
  if (!existsSync(watermarkPath)) {
    throw new Error(`AI 水印文件不存在：${watermarkPath}`)
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ai-feiyi-compliance-'))
  const inputPath = path.join(tempDir, `${taskId}-source.mp4`)
  const outputPath = path.join(tempDir, `${taskId}-aigc.mp4`)
  const aigcMetadata = JSON.stringify(buildAigcMetadata(taskId))
  const filterGraph = [
    "[1:v][0:v]scale2ref=w='round(iw*261/1080)':h='round(iw*50/1080)'[watermark][base]",
    "[base][watermark]overlay=x='round(main_w*122/1080)':y='main_h-overlay_h-round(main_w*60/1080)':format=auto:shortest=1[video]",
  ].join(';')

  try {
    await writeFile(inputPath, videoBuffer)
    await execFileAsync(
      ffmpeg.path,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputPath,
        '-loop',
        '1',
        '-i',
        watermarkPath,
        '-filter_complex',
        filterGraph,
        '-map',
        '[video]',
        '-map',
        '0:a?',
        '-map_metadata',
        '0',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-metadata',
        `AIGC=${aigcMetadata}`,
        '-metadata',
        `WATERMARKFLAG=${watermarkFlag}`,
        '-movflags',
        '+faststart+use_metadata_tags',
        '-max_muxing_queue_size',
        '2048',
        outputPath,
      ],
      {
        windowsHide: true,
        timeout: 4 * 60 * 1000,
        maxBuffer: 8 * 1024 * 1024,
      },
    )

    const output = await readFile(outputPath)
    assertMetadataIsAtFileHead(output)
    return output
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function downloadSourceVideo(sourceUrl) {
  let parsedUrl
  try {
    parsedUrl = new URL(sourceUrl)
  } catch {
    throw new Error('生成视频地址不正确，无法添加 AI 生成标识。')
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('生成视频地址仅支持 HTTP 或 HTTPS。')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)

  try {
    const response = await fetch(parsedUrl, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`下载生成视频失败：HTTP ${response.status}`)
    }

    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > maxSourceVideoBytes) {
      throw new Error('生成视频文件过大，无法添加 AI 生成标识。')
    }

    const body = Buffer.from(await response.arrayBuffer())
    if (body.length > maxSourceVideoBytes) {
      throw new Error('生成视频文件过大，无法添加 AI 生成标识。')
    }
    return body
  } finally {
    clearTimeout(timeout)
  }
}

function assertMetadataIsAtFileHead(videoBuffer) {
  const moovOffset = videoBuffer.indexOf(Buffer.from('moov'))
  const mdatOffset = videoBuffer.indexOf(Buffer.from('mdat'))
  const aigcOffset = videoBuffer.indexOf(Buffer.from('AIGC'))
  const watermarkFlagOffset = videoBuffer.indexOf(Buffer.from('WATERMARKFLAG'))

  if (moovOffset < 0 || mdatOffset < 0 || moovOffset > mdatOffset) {
    throw new Error('AI 标识视频未按要求将元数据写入文件头部。')
  }
  if (aigcOffset < 0 || watermarkFlagOffset < 0 || aigcOffset > mdatOffset || watermarkFlagOffset > mdatOffset) {
    throw new Error('AI 标识视频缺少 AIGC 或 WATERMARKFLAG 元数据。')
  }
}

function getContentProducer() {
  return process.env.AIGC_CONTENT_PRODUCER?.trim() || defaultContentProducer
}

function createIntegrityCode(stage, taskId, contentProducer) {
  const payload = `${stage}|${taskId}|${contentProducer}|${watermarkFlag}`
  const secret = process.env.AIGC_SIGNING_SECRET?.trim()
  if (secret) {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex')
  }
  return crypto.createHash('sha256').update(payload).digest('hex')
}
