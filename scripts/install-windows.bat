@echo off
setlocal
cd /d "%~dp0\.."
title JARVIS Installation

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is required.
  echo Install the current Node.js LTS from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

echo Installing JARVIS components...
call npm install
if errorlevel 1 (
  echo Installation failed. Review the error above.
  pause
  exit /b 1
)

echo.
echo Installing free local voice. This may take several minutes the first time...
call "%~dp0setup-local-voice.bat"

echo.
echo Installation complete. Starting JARVIS...
call npm start
