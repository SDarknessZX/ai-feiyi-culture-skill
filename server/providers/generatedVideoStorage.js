import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createVideoPosterBuffer } from './videoPoster.js'

export async function cacheGeneratedVideo(videoUrl, taskId, outputRoot) {
  const fileName = `${taskId}.mp4`
  const posterFileName = `${taskId}.jpg`
  const outputPath = path.join(outputRoot, fileName)
  const posterPath = path.join(outputRoot, posterFileName)
  const publicPath = `/generated-videos/${fileName}`
  const posterPublicPath = `/generated-videos/${posterFileName}`

  try {
    await access(outputPath)
    return {
      videoUrl: publicPath,
      posterUrl: await ensureLocalPoster(outputPath, posterPath, posterPublicPath, taskId),
    }
  } catch {
    // The video has not been cached yet.
  }

  const response = await fetch(videoUrl)
  if (!response.ok) {
    throw new Error(`Failed to download generated video: HTTP ${response.status}`)
  }

  await mkdir(outputRoot, { recursive: true })
  const tempPath = `${outputPath}.${process.pid}.download`
  await writeFile(tempPath, Buffer.from(await response.arrayBuffer()))
  try {
    await rename(tempPath, outputPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    try {
      await access(outputPath)
    } catch {
      throw error
    }
  }

  return {
    videoUrl: publicPath,
    posterUrl: await ensureLocalPoster(outputPath, posterPath, posterPublicPath, taskId),
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
