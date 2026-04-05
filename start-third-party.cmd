@echo off
setlocal

if not "%OPENAI_API_KEY%"=="" if not "%OPENAI_BASE_URL%"=="" if not "%OPENAI_MODEL%"=="" goto run

powershell -ExecutionPolicy Bypass -File "%~dp0start-third-party.ps1" %*
exit /b %ERRORLEVEL%

:run
set "CLAUDE_CODE_USE_OPENAI=1"
set "CLAUDE_CODE_USE_OLLAMA="
set "CLAUDE_CODE_USE_CODEX="
echo Starting Claude Code with %OPENAI_MODEL% via configured OpenAI-compatible API...
node "%~dp0scripts\run-built.cjs" %*
