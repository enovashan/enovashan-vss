@echo off
setlocal
set "ENOVASHAN_LAUNCHER_DIR=%~dp0"
powershell.exe -NoProfile -Command "$ErrorActionPreference = 'Stop'; try { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User'); $helper = Join-Path $env:ENOVASHAN_LAUNCHER_DIR 'enovashan-video-helper.cjs'; if (-not (Test-Path -LiteralPath $helper)) { $helper = Join-Path $env:ENOVASHAN_LAUNCHER_DIR 'video-helper.cjs' }; if (-not (Test-Path -LiteralPath $helper)) { throw 'Download the latest local helper from CMS and save it in the same folder as this launcher.' }; if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found. Install Node.js 22 or newer, then try again.' }; & node $helper '--open-cms'; exit $LASTEXITCODE } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }"
if errorlevel 1 (
  echo.
  echo Helper could not start. If another helper is running, keep using that window.
  pause
)
