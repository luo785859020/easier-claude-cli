[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$ApiKey,
  [string]$BaseUrl,
  [string]$Model,
  [switch]$Save,
  [switch]$NoSave,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ForwardArgs
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-ClaudeConfigPath {
  if ($env:CLAUDE_CONFIG_DIR) {
    return Join-Path $env:CLAUDE_CONFIG_DIR '.claude.json'
  }

  if ($env:USERPROFILE) {
    return Join-Path $env:USERPROFILE '.claude.json'
  }

  return Join-Path $HOME '.claude.json'
}

function Ensure-ObjectProperty {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Object,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [object]$Value
  )

  if ($Object.PSObject.Properties.Name -contains $Name) {
    $Object.$Name = $Value
  } else {
    Add-Member -InputObject $Object -NotePropertyName $Name -NotePropertyValue $Value
  }
}

function Get-ObjectPropertyValue {
  param(
    [object]$Object,
    [string]$Name
  )

  if ($null -eq $Object) {
    return $null
  }

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }

  return [string]$property.Value
}

function Read-ClaudeConfig {
  $configPath = Get-ClaudeConfigPath
  if (-not (Test-Path $configPath)) {
    return [pscustomobject]@{}
  }

  try {
    $raw = Get-Content $configPath -Raw -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return [pscustomobject]@{}
    }

    return $raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    Write-Warning "Unable to parse existing Claude config at $configPath. A new env block will be written if you choose to save."
    return [pscustomobject]@{}
  }
}

function Save-ThirdPartyProviderConfig {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ResolvedApiKey,
    [Parameter(Mandatory = $true)]
    [string]$ResolvedBaseUrl,
    [Parameter(Mandatory = $true)]
    [string]$ResolvedModel
  )

  $configPath = Get-ClaudeConfigPath
  $config = Read-ClaudeConfig

  if (-not ($config.PSObject.Properties.Name -contains 'env') -or $null -eq $config.env) {
    Ensure-ObjectProperty -Object $config -Name 'env' -Value ([pscustomobject]@{})
  }

  $envConfig = $config.env
  Ensure-ObjectProperty -Object $envConfig -Name 'CLAUDE_CODE_USE_OPENAI' -Value '1'
  Ensure-ObjectProperty -Object $envConfig -Name 'OPENAI_API_KEY' -Value $ResolvedApiKey
  Ensure-ObjectProperty -Object $envConfig -Name 'OPENAI_BASE_URL' -Value $ResolvedBaseUrl
  Ensure-ObjectProperty -Object $envConfig -Name 'OPENAI_MODEL' -Value $ResolvedModel

  foreach ($key in @('CLAUDE_CODE_USE_OLLAMA', 'CLAUDE_CODE_USE_CODEX', 'CLAUDE_CODE_OPENAI_VENDOR_NAME')) {
    if ($envConfig.PSObject.Properties.Name -contains $key) {
      $envConfig.PSObject.Properties.Remove($key)
    }
  }

  $configDir = Split-Path -Parent $configPath
  if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir | Out-Null
  }

  $config | ConvertTo-Json -Depth 20 | Set-Content -Path $configPath -Encoding UTF8
  return $configPath
}

function Resolve-Value {
  param(
    [string]$Explicit,
    [string]$EnvironmentValue,
    [string]$SavedValue
  )

  foreach ($candidate in @($Explicit, $EnvironmentValue, $SavedValue)) {
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      return $candidate.Trim()
    }
  }

  return $null
}

function Read-ValueWithDefault {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt,
    [string]$DefaultValue
  )

  if ([string]::IsNullOrWhiteSpace($DefaultValue)) {
    return (Read-Host $Prompt).Trim()
  }

  $value = Read-Host "$Prompt [$DefaultValue]"
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultValue.Trim()
  }

  return $value.Trim()
}

$savedConfig = Read-ClaudeConfig
$savedEnv = $savedConfig.env
$usedSavedApiKey = $false
$usedSavedBaseUrl = $false
$usedSavedModel = $false
$promptedApiKey = $false
$promptedBaseUrl = $false
$promptedModel = $false
$explicitApiKey = -not [string]::IsNullOrWhiteSpace($ApiKey)
$explicitBaseUrl = -not [string]::IsNullOrWhiteSpace($BaseUrl)
$explicitModel = -not [string]::IsNullOrWhiteSpace($Model)
$savedApiKey = Get-ObjectPropertyValue -Object $savedEnv -Name 'OPENAI_API_KEY'
$savedBaseUrl = Get-ObjectPropertyValue -Object $savedEnv -Name 'OPENAI_BASE_URL'
$savedModel = Get-ObjectPropertyValue -Object $savedEnv -Name 'OPENAI_MODEL'

$resolvedBaseUrl = Resolve-Value `
  -Explicit $BaseUrl `
  -EnvironmentValue $env:OPENAI_BASE_URL `
  -SavedValue $savedBaseUrl
if (-not $explicitBaseUrl -and [string]::IsNullOrWhiteSpace($env:OPENAI_BASE_URL) -and -not [string]::IsNullOrWhiteSpace($savedBaseUrl) -and $resolvedBaseUrl -eq $savedBaseUrl.Trim()) {
  $usedSavedBaseUrl = $true
}
if ([string]::IsNullOrWhiteSpace($resolvedBaseUrl)) {
  $resolvedBaseUrl = Read-ValueWithDefault `
    -Prompt 'Base URL' `
    -DefaultValue 'https://api.openai.com/v1'
  $promptedBaseUrl = $true
}

$resolvedModel = Resolve-Value `
  -Explicit $Model `
  -EnvironmentValue $env:OPENAI_MODEL `
  -SavedValue $savedModel
if (-not $explicitModel -and [string]::IsNullOrWhiteSpace($env:OPENAI_MODEL) -and -not [string]::IsNullOrWhiteSpace($savedModel) -and $resolvedModel -eq $savedModel.Trim()) {
  $usedSavedModel = $true
}
if ([string]::IsNullOrWhiteSpace($resolvedModel)) {
  $resolvedModel = Read-ValueWithDefault `
    -Prompt 'Model name' `
    -DefaultValue ''
  $promptedModel = $true
}

$resolvedApiKey = Resolve-Value `
  -Explicit $ApiKey `
  -EnvironmentValue $env:OPENAI_API_KEY `
  -SavedValue $savedApiKey
if (-not $explicitApiKey -and [string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY) -and -not [string]::IsNullOrWhiteSpace($savedApiKey) -and $resolvedApiKey -eq $savedApiKey.Trim()) {
  $usedSavedApiKey = $true
}
if ([string]::IsNullOrWhiteSpace($resolvedApiKey)) {
  $secure = Read-Host 'API Key' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $resolvedApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  $promptedApiKey = $true
}

if ([string]::IsNullOrWhiteSpace($resolvedModel)) {
  throw 'Model name is required.'
}

$shouldSave = $false
if ($Save.IsPresent -and $NoSave.IsPresent) {
  throw 'Use only one of -Save or -NoSave.'
}

if ($Save.IsPresent) {
  $shouldSave = $true
} elseif (
  -not $NoSave.IsPresent -and (
    $explicitApiKey -or
    $explicitBaseUrl -or
    $explicitModel -or
    $promptedApiKey -or
    $promptedBaseUrl -or
    $promptedModel -or
    -not ($usedSavedApiKey -and $usedSavedBaseUrl -and $usedSavedModel)
  )
) {
  $saveAnswer = Read-Host 'Save these settings to local Claude config for next time? [Y/n]'
  if ([string]::IsNullOrWhiteSpace($saveAnswer) -or $saveAnswer.Trim().ToLower() -in @('y', 'yes')) {
    $shouldSave = $true
  }
}

if ($shouldSave) {
  $configPath = Save-ThirdPartyProviderConfig `
    -ResolvedApiKey $resolvedApiKey `
    -ResolvedBaseUrl $resolvedBaseUrl `
    -ResolvedModel $resolvedModel
  Write-Host "Saved provider settings to $configPath" -ForegroundColor DarkGray
}

$env:CLAUDE_CODE_USE_OPENAI = '1'
Remove-Item Env:CLAUDE_CODE_USE_OLLAMA -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_USE_CODEX -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_OPENAI_VENDOR_NAME -ErrorAction SilentlyContinue
$env:OPENAI_API_KEY = $resolvedApiKey
$env:OPENAI_BASE_URL = $resolvedBaseUrl
$env:OPENAI_MODEL = $resolvedModel

Write-Host "Starting Claude Code with $resolvedModel via configured OpenAI-compatible API..." -ForegroundColor Cyan
& 'node' (Join-Path $root 'scripts\run-built.cjs') @ForwardArgs
