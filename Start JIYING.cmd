@echo off
setlocal
cd /d "%~dp0"
set "JIYING_PREVIEW_PORT=%~1"
if "%JIYING_PREVIEW_PORT%"=="" set "JIYING_PREVIEW_PORT=3000"
powershell -NoLogo -ExecutionPolicy Bypass -File "%~dp0scripts\launch-jiying.ps1" -PreviewPort %JIYING_PREVIEW_PORT%
if errorlevel 1 (
  echo.
  echo JIYING launcher failed. Press any key to close this window.
  pause >nul
  exit /b %errorlevel%
)
