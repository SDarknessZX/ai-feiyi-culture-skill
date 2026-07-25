@echo off
chcp 65001 >nul
cd /d %~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-public.ps1"
echo.
echo 隧道已断开。按任意键关闭窗口...
pause >nul
