import fs from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()
const envPath = path.join(projectRoot, '.env')
const appKey = process.env.AUDIT_APP_KEY?.trim() || ''

if (!fs.existsSync(envPath)) {
  console.error(`未找到 ${envPath}，请在项目根目录执行本命令。`)
  process.exit(1)
}

if (Buffer.byteLength(appKey, 'utf8') !== 16) {
  console.error('AUDIT_APP_KEY 必须是咪咕提供的 16 字节机审秘钥。')
  process.exit(1)
}

const values = {
  AUDIT_ACCOUNT: 'ASCFFYWH',
  AUDIT_APP_KEY: appKey,
  AUDIT_CALLBACK_NAME: 'ASCFFYWHCallback',
}

const original = fs.readFileSync(envPath, 'utf8')
const newline = original.includes('\r\n') ? '\r\n' : '\n'
let updated = original

for (const [name, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  if (pattern.test(updated)) {
    updated = updated.replace(pattern, `${name}=${value}`)
  } else {
    if (updated && !updated.endsWith('\n')) updated += newline
    updated += `${name}=${value}${newline}`
  }
}

const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const backupPath = `${envPath}.backup-${stamp}`
fs.copyFileSync(envPath, backupPath, fs.constants.COPYFILE_EXCL)
fs.writeFileSync(envPath, updated, { encoding: 'utf8', mode: 0o600 })
if (process.platform !== 'win32') fs.chmodSync(envPath, 0o600)

console.log('咪咕机审参数已写入 .env。')
console.log(`原配置备份：${backupPath}`)
console.log('已配置：AUDIT_ACCOUNT / AUDIT_APP_KEY / AUDIT_CALLBACK_NAME')
