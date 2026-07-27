import 'dotenv/config'
import { migrateRecentArchivedVideos } from './providers/videoArchive.js'

const results = await migrateRecentArchivedVideos({
  onProgress: ({ current, total, taskId }) => {
    console.log(`[${current}/${total}] 正在迁移 ${taskId}`)
  },
})

const failed = results.filter((item) => item.status === 'failed')
for (const result of results) {
  if (result.status === 'migrated') {
    console.log(`已迁移 ${result.taskId}`)
  } else {
    console.error(`迁移失败 ${result.taskId}: ${result.message}`)
  }
}

console.log(`迁移完成：成功 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) process.exitCode = 1
