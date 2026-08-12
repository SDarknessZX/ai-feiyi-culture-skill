import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function isBlankSignalStats(stats) {
  const average = Number(stats?.YAVG)
  const high = Number(stats?.YHIGH)
  const maximum = Number(stats?.YMAX)
  if (![average, high, maximum].every(Number.isFinite)) return false
  return average <= 3 && high <= 6 && maximum <= 12
}

export async function assertImageHasVisibleContent(filePath) {
  let stderr = ''
  try {
    const result = await execFileAsync(
      ffmpeg.path,
      [
        '-hide_banner',
        '-i',
        filePath,
        '-vf',
        'signalstats,metadata=print',
        '-frames:v',
        '1',
        '-f',
        'null',
        '-',
      ],
      { windowsHide: true, timeout: 20_000, maxBuffer: 2 * 1024 * 1024 },
    )
    stderr = result.stderr || ''
  } catch (error) {
    stderr = error?.stderr || ''
    if (!stderr.includes('lavfi.signalstats.YAVG=')) {
      throw new Error('图片解码失败，请重新选择 JPG、PNG 或 WebP 图片。')
    }
  }

  const stats = Object.fromEntries(
    [...stderr.matchAll(/lavfi\.signalstats\.([A-Z]+)=(-?[\d.]+)/g)].map((match) => [match[1], Number(match[2])]),
  )
  if (isBlankSignalStats(stats)) {
    const error = new Error('检测到上传图片为全黑画面，请重新选择原图并再次裁剪。')
    error.code = 'BLANK_IMAGE'
    throw error
  }
}
