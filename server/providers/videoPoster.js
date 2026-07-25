import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function createVideoPosterBuffer(videoBuffer, taskId = 'video') {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ai-feiyi-poster-'))
  const inputPath = path.join(tempDir, `${taskId}.mp4`)
  const outputPath = path.join(tempDir, `${taskId}.jpg`)

  try {
    await writeFile(inputPath, videoBuffer)
    const attempts = [
      ['-y', '-sseof', '-2', '-i', inputPath, '-vf', 'thumbnail=12', '-frames:v', '1', '-q:v', '3', outputPath],
      ['-y', '-sseof', '-4', '-i', inputPath, '-vf', 'thumbnail=24', '-frames:v', '1', '-q:v', '3', outputPath],
      ['-y', '-ss', '1', '-i', inputPath, '-vf', 'thumbnail=12', '-frames:v', '1', '-q:v', '3', outputPath],
    ]

    for (const args of attempts) {
      try {
        await runFfmpeg(args)
        return await readFile(outputPath)
      } catch {
        // Try another nearby frame when the selected moment is blank or unavailable.
      }
    }

    throw new Error('Failed to create video poster.')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function runFfmpeg(args) {
  await execFileAsync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', ...args], {
    windowsHide: true,
    timeout: 45_000,
  })
}
