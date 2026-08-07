import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

// 基础配置来自 .env；服务器私密配置可放入不会被 Git 跟踪的 .env.local，并覆盖同名项。
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
dotenv.config({ path: path.join(projectRoot, '.env.local'), override: true, quiet: true })
