@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没找到 Node.js，请先安装：https://nodejs.org  （选 LTS 版本）
  echo 或者直接用网页版：双击 open-web.cmd
  pause
  exit /b 1
)
if "%~1"=="" (
  echo 用法：把图片拖到 run.cmd 上，或执行  run.cmd 你的图片.png
  echo.
  set /p F=输入图片路径： 
  if "%F%"=="" exit /b 0
  node "%~dp0img2cad.mjs" "%F%"
) else (
  node "%~dp0img2cad.mjs" %*
)
echo.
pause
