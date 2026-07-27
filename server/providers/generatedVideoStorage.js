import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createVideoPosterBuffer } from './videoPoster.js'

export async function cacheGeneratedVideo(videoBuffer, taskId, outputRoot) {
  const fileName = `${taskId}.mp4`
  const posterFileName = `${taskId}.jpg`
  const markerFileName = `${taskId}.aigc.json`
  const outputPath = path.join(outputRoot, fileName)
  const posterPath = path.join(outputRoot, posterFileName)
  const markerPath = path.join(outputRoot, markerFileName)
  const publicPath = `/generated-videos/${fileName}`
  const posterPublicPath = `/generated-videos/${posterFileName}`

  try {
    await Promise.all([access(outputPath), access(markerPath)])
    return {
      videoUrl: publicPath,
      posterUrl: await ensureLocalPoster(outputPath, posterPath, posterPublicPath, taskId),
    }
  } catch {
    // The video has not been cached yet, or the old cache did not include AI labels.
  }

  if (!videoBuffer?.length) {
    throw new Error('Cannot cache an empty compliant video.')
  }

  await mkdir(outputRoot, { recursive: true })
  await writeFile(outputPath, videoBuffer)
  await writeFile(markerPath, JSON.stringify({ AIGC: true, WATERMARKFLAG: '3' }))

  return {
    videoUrl: publicPath,
    posterUrl: await writeLocalPoster(outputPath, posterPath, posterPublicPath, taskId),
  }
}

async function ensureLocalPoster(videoPath, posterPath, posterPublicPath, taskId) {
  try {
    await access(posterPath)
    return posterPublicPath
  } catch {
    // Poster has not been created yet.
  }

  try {
    const videoBody = await readFile(videoPath)
    const posterBody = await createVideoPosterBuffer(videoBody, taskId)
    await writeFile(posterPath, posterBody)
    return posterPublicPath
  } catch (error) {
    console.warn('Failed to create local generated-video poster.', error)
    return ''
  }
}

async function writeLocalPoster(videoPath, posterPath, posterPublicPath, taskId) {
  try {
    const videoBody = await readFile(videoPath)
    const posterBody = await createVideoPosterBuffer(videoBody, taskId)
    await writeFile(posterPath, posterBody)
    return posterPublicPath
  } catch (error) {
    console.warn('Failed to create local generated-video poster.', error)
    return ''
  }
}
