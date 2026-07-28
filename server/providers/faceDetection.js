import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const yunetScriptPath = path.join(__dirname, '..', 'yunetFaceDetect.py')
const defaultYunetModelPath = path.join(__dirname, '..', 'models', 'face_detection_yunet_2023mar.onnx')
const resultPrefix = 'FACE_DETECT_RESULT='
const resultCache = new Map()

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeBoxes(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((box) => Array.isArray(box) && box.length >= 4)
    .map((box) => box.slice(0, 4).map((coordinate) => Math.round(Number(coordinate))))
    .filter((box) => box.every(Number.isFinite))
}

function extractBoxes(payload) {
  if (Array.isArray(payload)) return normalizeBoxes(payload)
  return normalizeBoxes(
    payload?.faceBoundingBoxes ??
      payload?.face_bounding_boxes ??
      payload?.boxes ??
      payload?.data?.faceBoundingBoxes ??
      payload?.data?.face_bounding_boxes ??
      payload?.data?.boxes,
  )
}

function getCachedResult(imageHash) {
  const cached = resultCache.get(imageHash)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    resultCache.delete(imageHash)
    return null
  }
  return cached.result
}

function cacheResult(imageHash, result) {
  const ttlMs = positiveNumber(process.env.FACE_DETECT_CACHE_TTL_MS, 15 * 60 * 1000)
  resultCache.set(imageHash, { result, expiresAt: Date.now() + ttlMs })
  if (resultCache.size <= 200) return
  const now = Date.now()
  for (const [key, value] of resultCache) {
    if (value.expiresAt <= now || resultCache.size > 200) resultCache.delete(key)
  }
}

async function detectWithEndpoint({ buffer, file }) {
  const endpoint = process.env.FACE_DETECT_ENDPOINT?.trim()
  if (!endpoint) throw new Error('未配置 FACE_DETECT_ENDPOINT。')

  const controller = new AbortController()
  const timeoutMs = positiveNumber(process.env.FACE_DETECT_TIMEOUT_MS, 120_000)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const formData = new FormData()
  formData.append('image', new Blob([buffer], { type: file.mimetype || 'application/octet-stream' }), file.originalname || 'image')

  const headers = {}
  const apiKey = process.env.FACE_DETECT_API_KEY?.trim()
  if (apiKey) {
    const headerName = process.env.FACE_DETECT_API_KEY_HEADER?.trim() || 'Authorization'
    headers[headerName] = headerName.toLowerCase() === 'authorization' ? `Bearer ${apiKey}` : apiKey
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(payload?.message || `火山人脸检测服务返回 HTTP ${response.status}。`)
    }
    return {
      boxes: extractBoxes(payload),
      provider: 'volcengine-las-endpoint',
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('火山人脸检测超时，请稍后重试。')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function getPythonCandidates() {
  const configuredPython = process.env.FACE_DETECT_PYTHON?.trim()
  if (configuredPython) {
    return [
      {
        command: configuredPython,
        args: process.env.FACE_DETECT_PYTHON_ARGS?.trim()
          ? process.env.FACE_DETECT_PYTHON_ARGS.trim().split(/\s+/)
          : [],
      },
    ]
  }
  if (process.platform === 'win32') {
    return [
      { command: 'py', args: ['-3.11'] },
      { command: 'py', args: ['-3.10'] },
      { command: 'py', args: ['-3'] },
      { command: 'python', args: [] },
    ]
  }
  return [
    { command: 'python3', args: [] },
    { command: 'python', args: [] },
  ]
}

function localDetectionError(message, retryable = false) {
  const error = new Error(message)
  error.retryable = retryable
  return error
}

function runLocalYunet({ command, args }, filePath, modelPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      [...args, yunetScriptPath, '--image-path', path.resolve(filePath), '--model-path', modelPath],
      {
        env: process.env,
        windowsHide: true,
      },
    )
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }

    const timeout = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error('本地 YuNet 人脸检测超时，请稍后重试。')))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-128 * 1024)
    })
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-128 * 1024)
    })
    child.on('error', (error) => {
      finish(() => reject(localDetectionError(`无法启动 Python：${error.message}`, true)))
    })
    child.on('close', (code) => {
      finish(() => {
        if (code !== 0) {
          const errorOutput = stderr.trim()
          if (/No module named ['"]cv2|opencv/i.test(errorOutput)) {
            reject(localDetectionError('当前 Python 环境未安装 OpenCV。', true))
            return
          }
          if (/Requested Python version|not installed|No suitable Python runtime/i.test(errorOutput)) {
            reject(localDetectionError('未找到指定版本的 Python。', true))
            return
          }
          if (/模型文件不存在|FACE_DETECT_MODEL_PATH|onnx/i.test(errorOutput)) {
            reject(new Error('YuNet 模型不可用，请检查 FACE_DETECT_MODEL_PATH。'))
            return
          }
          reject(new Error(`本地 YuNet 人脸检测执行失败（退出码 ${code}）。`))
          return
        }
        const resultLine = stdout
          .split(/\r?\n/)
          .reverse()
          .find((line) => line.startsWith(resultPrefix))
        if (!resultLine) {
          reject(new Error('本地 YuNet 人脸检测未返回可解析结果。'))
          return
        }
        try {
          const payload = JSON.parse(resultLine.slice(resultPrefix.length))
          resolve({
            boxes: extractBoxes(payload),
            provider: 'opencv-yunet-local',
          })
        } catch {
          reject(new Error('本地 YuNet 人脸检测结果格式不正确。'))
        }
      })
    })
  })
}

async function detectWithLocalYunet(filePath) {
  const modelPath = path.resolve(process.env.FACE_DETECT_MODEL_PATH?.trim() || defaultYunetModelPath)
  const timeoutMs = positiveNumber(process.env.FACE_DETECT_LOCAL_TIMEOUT_MS, 30_000)
  let lastError

  for (const candidate of getPythonCandidates()) {
    try {
      return await runLocalYunet(candidate, filePath, modelPath, timeoutMs)
    } catch (error) {
      lastError = error
      if (!error?.retryable) throw error
    }
  }

  throw new Error(
    `未找到已安装 OpenCV 的可用 Python 3 环境，请运行对应版本的 pip install -r requirements-face-detect.txt。${
      lastError?.message ? `（${lastError.message}）` : ''
    }`,
  )
}

export async function detectFaces(file) {
  if (!file?.path) throw new Error('缺少待检测的图片文件。')
  const buffer = await readFile(file.path)
  const imageHash = crypto.createHash('sha256').update(buffer).digest('hex')
  const cached = getCachedResult(imageHash)
  if (cached) return { ...cached, cached: true }

  const detection = process.env.FACE_DETECT_ENDPOINT?.trim()
    ? await detectWithEndpoint({ buffer, file })
    : await detectWithLocalYunet(file.path)
  const result = {
    hasFace: detection.boxes.length > 0,
    faceBoundingBoxes: detection.boxes,
    provider: detection.provider,
  }
  cacheResult(imageHash, result)
  return { ...result, cached: false }
}

export function getFaceDetectionConfigReport() {
  const endpoint = process.env.FACE_DETECT_ENDPOINT?.trim()
  const modelPath = path.resolve(process.env.FACE_DETECT_MODEL_PATH?.trim() || defaultYunetModelPath)
  return {
    enabled: Boolean(endpoint || existsSync(modelPath)),
    mode: endpoint ? 'endpoint' : 'opencv-yunet-local',
    endpointConfigured: Boolean(endpoint),
    modelPath,
    modelConfigured: existsSync(modelPath),
  }
}
