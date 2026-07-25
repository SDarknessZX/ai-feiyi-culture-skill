import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

// 把 Ark 返回的临时视频链接转存到本地，作品库里保存的本地地址才不会过期。
export async function cacheGeneratedVideo(videoUrl, taskId, outputRoot) {
  const fileName = `${taskId}.mp4`
  const outputPath = path.join(outputRoot, fileName)
  const publicPath = `/generated-videos/${fileName}`

  try {
    await access(outputPath)
    return publicPath
  } catch {
    // 尚未转存，继续下载
  }

  const response = await fetch(videoUrl)
  if (!response.ok) {
    throw new Error(`下载生成视频失败：HTTP ${response.status}`)
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

  return publicPath
}
