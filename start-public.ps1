# 一键启动：构建生产版 + API 服务 + serveo 公网隧道
# 双击“一键启动公网.cmd”即可运行本脚本；关闭窗口 = 断开公网。
# 公网走 8790 端口的生产构建（快）；本地开发照旧用 npm run dev（5188）。
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

# 1. 构建最新的生产版前端（首次或代码有改动时必需，几秒钟）
Write-Host '正在构建生产版页面 (npm run build)...'
cmd /c 'npm run build'
if ($LASTEXITCODE -ne 0) {
  Write-Host '构建失败，请检查上面的报错。' -ForegroundColor Red
  exit 1
}

# 2. API 服务没在跑就新开一个窗口跑 npm run api
$apiRunning = Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue
if (-not $apiRunning) {
  Write-Host '正在启动 API 服务 (npm run api)，会弹出一个新窗口，请不要关闭它...'
  Start-Process cmd -ArgumentList '/k', 'npm run api' -WorkingDirectory $PSScriptRoot
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    if (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue) { break }
  }
  if (-not (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue)) {
    Write-Host 'API 服务启动超时，请先检查新窗口里的报错。' -ForegroundColor Red
    exit 1
  }
  Write-Host 'API 服务已就绪。' -ForegroundColor Green
} else {
  Write-Host 'API 服务已在运行，跳过启动。' -ForegroundColor Green
}

# 3. 清掉旧的 serveo 隧道，避免开出多个地址
Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" |
  Where-Object { $_.CommandLine -match 'serveo\.net' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 4. 启动公网隧道（前台运行，本窗口保持开启才有公网）
Write-Host ''
Write-Host '正在连接公网... 下面绿色一行里的 https://xxx.serveousercontent.com 就是手机访问地址。' -ForegroundColor Yellow
Write-Host '想停止公网分享，直接关闭本窗口即可（API 服务窗口可以继续留着）。'
Write-Host ''
ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes -R 80:127.0.0.1:8790 serveo.net
