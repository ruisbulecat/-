@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
setlocal
cd /d "%~dp0"
title 赌徒模拟器 · 本地 / 局域网联机

where py >nul 2>nul
if not errorlevel 1 (
  echo 正在用 Python 启动局域网服务器...
  echo.
  py -3 -u server\lan-server.py
  goto :end
)

where python >nul 2>nul
if not errorlevel 1 (
  echo 正在用 Python 启动局域网服务器...
  echo.
  python -u server\lan-server.py
  goto :end
)

where node >nul 2>nul
if not errorlevel 1 (
  echo 正在用 Node.js 启动局域网服务器...
  echo.
  node server\lan-server.js
  goto :end
)

echo 未检测到 Python 或 Node.js。
echo 请安装 Python 3（安装时勾选 Add Python to PATH）或 Node.js LTS 后再试。
echo 正在打开 Python 下载页...
start "" "https://www.python.org/downloads/windows/"

:end
echo.
echo 服务器已停止。按任意键关闭窗口。
pause >nul
