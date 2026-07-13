@echo off
setlocal
cd /d "%~dp0\.."
title Build JARVIS Giveaway Installer
echo Installing build components...
call npm install
if errorlevel 1 goto :failed
call npm run test
if errorlevel 1 goto :failed
echo Building the Windows installer...
call npm run dist
if errorlevel 1 goto :failed
echo.
echo DONE: dist\JARVIS-FREE-SETUP.exe
pause
exit /b 0

:failed
echo.
echo The installer build failed. Keep this window open and take a screenshot.
pause
exit /b 1
