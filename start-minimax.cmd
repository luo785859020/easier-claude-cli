@echo off
setlocal
if not "%OPENAI_API_KEY%"=="" goto run

powershell -ExecutionPolicy Bypass -File "%~dp0start-minimax.ps1" %*
exit /b %ERRORLEVEL%

:run
set "CLAUDE_CODE_USE_OPENAI=1"
set "OPENAI_BASE_URL=https://api.minimaxi.com/v1"
set "OPENAI_MODEL=MiniMax-M2.7"
set "CLAUDE_CODE_USE_OLLAMA="
set "CLAUDE_CODE_USE_CODEX="
echo Starting Claude Code with MiniMax-M2.7 via OpenAI-compatible API...
node "%~dp0scripts\run-built.cjs" %*
