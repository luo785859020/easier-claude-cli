@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0start-volcengine.ps1" %*
exit /b %ERRORLEVEL%
