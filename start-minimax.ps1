param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ForwardArgs
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $env:OPENAI_API_KEY) {
  $secure = Read-Host 'MiniMax API Key' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

$env:CLAUDE_CODE_USE_OPENAI = '1'
Remove-Item Env:CLAUDE_CODE_USE_OLLAMA -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_USE_CODEX -ErrorAction SilentlyContinue
$env:OPENAI_BASE_URL = 'https://api.minimaxi.com/v1'
$env:OPENAI_MODEL = 'MiniMax-M2.7'

Write-Host 'Starting Claude Code with MiniMax-M2.7 via OpenAI-compatible API...' -ForegroundColor Cyan
& 'node' (Join-Path $root 'scripts\run-built.cjs') @ForwardArgs
