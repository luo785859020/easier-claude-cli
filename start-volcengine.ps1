[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$ApiKey,
  [string]$BaseUrl,
  [string]$Model,
  [switch]$EnableSpeech,
  [switch]$DisableSpeech,
  [string]$SpeechApiKey,
  [string]$SpeechBaseUrl,
  [string]$SpeechSttModel,
  [string]$SpeechTtsModel,
  [string]$SpeechTtsVoice,
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

function Test-TruthyValue {
  param(
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $false
  }

  return $Value.Trim().ToLower() -in @('1', 'true', 'yes', 'on')
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

function Read-OptionalValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt,
    [string]$DefaultValue
  )

  if ([string]::IsNullOrWhiteSpace($DefaultValue)) {
    $value = Read-Host $Prompt
  } else {
    $value = Read-Host "$Prompt [$DefaultValue]"
  }

  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultValue
  }

  return $value.Trim()
}

function Set-OptionalEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
  } else {
    Set-Item "Env:$Name" $Value
  }
}

function Save-VolcengineConfig {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ResolvedApiKey,
    [Parameter(Mandatory = $true)]
    [string]$ResolvedBaseUrl,
    [Parameter(Mandatory = $true)]
    [string]$ResolvedModel,
    [Parameter(Mandatory = $true)]
    [bool]$SpeechEnabled,
    [string]$ResolvedSpeechApiKey,
    [string]$ResolvedSpeechBaseUrl,
    [string]$ResolvedSpeechSttModel,
    [string]$ResolvedSpeechTtsModel,
    [string]$ResolvedSpeechTtsVoice
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

  if ($SpeechEnabled) {
    Ensure-ObjectProperty -Object $envConfig -Name 'CLAUDE_CODE_USE_OPENAI_SPEECH' -Value '1'

    foreach ($entry in @(
      @{ Name = 'OPENAI_SPEECH_API_KEY'; Value = $ResolvedSpeechApiKey },
      @{ Name = 'OPENAI_SPEECH_BASE_URL'; Value = $ResolvedSpeechBaseUrl },
      @{ Name = 'OPENAI_SPEECH_STT_MODEL'; Value = $ResolvedSpeechSttModel },
      @{ Name = 'OPENAI_SPEECH_TTS_MODEL'; Value = $ResolvedSpeechTtsModel },
      @{ Name = 'OPENAI_SPEECH_TTS_VOICE'; Value = $ResolvedSpeechTtsVoice }
    )) {
      if ([string]::IsNullOrWhiteSpace($entry.Value)) {
        if ($envConfig.PSObject.Properties.Name -contains $entry.Name) {
          $envConfig.PSObject.Properties.Remove($entry.Name)
        }
      } else {
        Ensure-ObjectProperty -Object $envConfig -Name $entry.Name -Value $entry.Value
      }
    }
  } else {
    foreach ($key in @(
      'CLAUDE_CODE_USE_OPENAI_SPEECH',
      'OPENAI_SPEECH_API_KEY',
      'OPENAI_SPEECH_BASE_URL',
      'OPENAI_SPEECH_STT_MODEL',
      'OPENAI_SPEECH_TTS_MODEL',
      'OPENAI_SPEECH_TTS_VOICE'
    )) {
      if ($envConfig.PSObject.Properties.Name -contains $key) {
        $envConfig.PSObject.Properties.Remove($key)
      }
    }
  }

  $configDir = Split-Path -Parent $configPath
  if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir | Out-Null
  }

  $config | ConvertTo-Json -Depth 20 | Set-Content -Path $configPath -Encoding UTF8
  return $configPath
}

if ($Save.IsPresent -and $NoSave.IsPresent) {
  throw 'Use only one of -Save or -NoSave.'
}

if ($EnableSpeech.IsPresent -and $DisableSpeech.IsPresent) {
  throw 'Use only one of -EnableSpeech or -DisableSpeech.'
}

$savedConfig = Read-ClaudeConfig
$savedEnv = $savedConfig.env

$savedApiKey = Get-ObjectPropertyValue -Object $savedEnv -Name 'OPENAI_API_KEY'
$savedBaseUrl = Get-ObjectPropertyValue -Object $savedEnv -Name 'OPENAI_BASE_URL'
$savedModel = Get-ObjectPropertyValue -Object $savedEnv -Name 'OPENAI_MODEL'

$savedSpeechEnabled = Test-TruthyValue (Get-ObjectPropertyValue -Object $savedEnv -Name 'CLAUDE_CODE_USE_OPENAI_SPEECH')
$savedSpeechApiKey = Get-ObjectPropertyValue -Object $savedEnv -Name 'OPENAI_SPEECH_API_KEY'
$savedSpeechBaseUrl = Get-ObjectPropertyValue -Object $savedEnv -Name 'OPENAI_SPEECH_BASE_URL'
$savedSpeechSttModel = Get-ObjectPropertyValue -Object $savedEnv -Name 'OPENAI_SPEECH_STT_MODEL'
$savedSpeechTtsModel = Get-ObjectPropertyValue -Object $savedEnv -Name 'OPENAI_SPEECH_TTS_MODEL'
$savedSpeechTtsVoice = Get-ObjectPropertyValue -Object $savedEnv -Name 'OPENAI_SPEECH_TTS_VOICE'

$resolvedBaseUrl = Resolve-Value `
  -Explicit $BaseUrl `
  -EnvironmentValue $env:OPENAI_BASE_URL `
  -SavedValue $savedBaseUrl
if ([string]::IsNullOrWhiteSpace($resolvedBaseUrl)) {
  $resolvedBaseUrl = Read-ValueWithDefault `
    -Prompt 'Volcengine chat Base URL' `
    -DefaultValue 'https://ark.cn-beijing.volces.com/api/v3'
}

$resolvedModel = Resolve-Value `
  -Explicit $Model `
  -EnvironmentValue $env:OPENAI_MODEL `
  -SavedValue $savedModel
if ([string]::IsNullOrWhiteSpace($resolvedModel)) {
  $resolvedModel = Read-ValueWithDefault `
    -Prompt 'Volcengine endpoint ID / model name' `
    -DefaultValue ''
}

$resolvedApiKey = Resolve-Value `
  -Explicit $ApiKey `
  -EnvironmentValue $env:OPENAI_API_KEY `
  -SavedValue $savedApiKey
if ([string]::IsNullOrWhiteSpace($resolvedApiKey)) {
  $secure = Read-Host 'Volcengine API Key' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $resolvedApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

if ([string]::IsNullOrWhiteSpace($resolvedModel)) {
  throw 'Endpoint ID / model name is required.'
}

$speechConfiguredFromArgs = @(
  $SpeechApiKey,
  $SpeechBaseUrl,
  $SpeechSttModel,
  $SpeechTtsModel,
  $SpeechTtsVoice
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

$hasExistingSpeechConfig =
  (Test-TruthyValue $env:CLAUDE_CODE_USE_OPENAI_SPEECH) -or
  $savedSpeechEnabled -or
  -not [string]::IsNullOrWhiteSpace($env:OPENAI_SPEECH_STT_MODEL) -or
  -not [string]::IsNullOrWhiteSpace($env:OPENAI_SPEECH_TTS_MODEL) -or
  -not [string]::IsNullOrWhiteSpace($savedSpeechSttModel) -or
  -not [string]::IsNullOrWhiteSpace($savedSpeechTtsModel)

$speechEnabled = $false
if ($EnableSpeech.IsPresent) {
  $speechEnabled = $true
} elseif ($DisableSpeech.IsPresent) {
  $speechEnabled = $false
} elseif ($speechConfiguredFromArgs.Count -gt 0) {
  $speechEnabled = $true
} elseif ($hasExistingSpeechConfig) {
  $speechEnabled = $true
} else {
  $enableSpeechAnswer = Read-Host 'Enable speech input/output for Volcengine now? [y/N]'
  if (-not [string]::IsNullOrWhiteSpace($enableSpeechAnswer) -and $enableSpeechAnswer.Trim().ToLower() -in @('y', 'yes')) {
    $speechEnabled = $true
  }
}

$resolvedSpeechApiKey = $null
$resolvedSpeechBaseUrl = $null
$resolvedSpeechSttModel = $null
$resolvedSpeechTtsModel = $null
$resolvedSpeechTtsVoice = $null

if ($speechEnabled) {
  $resolvedSpeechApiKey = Resolve-Value `
    -Explicit $SpeechApiKey `
    -EnvironmentValue $env:OPENAI_SPEECH_API_KEY `
    -SavedValue $savedSpeechApiKey
  if ([string]::IsNullOrWhiteSpace($resolvedSpeechApiKey)) {
    $reuseSpeechApiKey = Read-Host 'Reuse the chat API Key for speech? [Y/n]'
    if ([string]::IsNullOrWhiteSpace($reuseSpeechApiKey) -or $reuseSpeechApiKey.Trim().ToLower() -in @('y', 'yes')) {
      $resolvedSpeechApiKey = $resolvedApiKey
    } else {
      $secure = Read-Host 'Speech API Key' -AsSecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try {
        $resolvedSpeechApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
      } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
      }
    }
  }

  $resolvedSpeechBaseUrl = Resolve-Value `
    -Explicit $SpeechBaseUrl `
    -EnvironmentValue $env:OPENAI_SPEECH_BASE_URL `
    -SavedValue $savedSpeechBaseUrl
  $resolvedSpeechBaseUrl = Read-OptionalValue `
    -Prompt 'Speech Base URL (leave blank to reuse the chat Base URL)' `
    -DefaultValue $resolvedSpeechBaseUrl

  $resolvedSpeechSttModel = Resolve-Value `
    -Explicit $SpeechSttModel `
    -EnvironmentValue $env:OPENAI_SPEECH_STT_MODEL `
    -SavedValue $savedSpeechSttModel
  $resolvedSpeechSttModel = Read-OptionalValue `
    -Prompt 'Speech-to-text model (optional)' `
    -DefaultValue $resolvedSpeechSttModel

  $resolvedSpeechTtsModel = Resolve-Value `
    -Explicit $SpeechTtsModel `
    -EnvironmentValue $env:OPENAI_SPEECH_TTS_MODEL `
    -SavedValue $savedSpeechTtsModel
  $resolvedSpeechTtsModel = Read-OptionalValue `
    -Prompt 'Text-to-speech model (optional)' `
    -DefaultValue $resolvedSpeechTtsModel

  $resolvedSpeechTtsVoice = Resolve-Value `
    -Explicit $SpeechTtsVoice `
    -EnvironmentValue $env:OPENAI_SPEECH_TTS_VOICE `
    -SavedValue $savedSpeechTtsVoice
  if ([string]::IsNullOrWhiteSpace($resolvedSpeechTtsVoice)) {
    $resolvedSpeechTtsVoice = 'alloy'
  }
  $resolvedSpeechTtsVoice = Read-OptionalValue `
    -Prompt 'TTS voice' `
    -DefaultValue $resolvedSpeechTtsVoice

  if ([string]::IsNullOrWhiteSpace($resolvedSpeechSttModel) -and [string]::IsNullOrWhiteSpace($resolvedSpeechTtsModel)) {
    throw 'Set at least one speech model when speech is enabled.'
  }
}

$shouldSave = $false
if ($Save.IsPresent) {
  $shouldSave = $true
} elseif (-not $NoSave.IsPresent) {
  $saveAnswer = Read-Host 'Save these settings to local Claude config for next time? [Y/n]'
  if ([string]::IsNullOrWhiteSpace($saveAnswer) -or $saveAnswer.Trim().ToLower() -in @('y', 'yes')) {
    $shouldSave = $true
  }
}

if ($shouldSave) {
  $configPath = Save-VolcengineConfig `
    -ResolvedApiKey $resolvedApiKey `
    -ResolvedBaseUrl $resolvedBaseUrl `
    -ResolvedModel $resolvedModel `
    -SpeechEnabled $speechEnabled `
    -ResolvedSpeechApiKey $resolvedSpeechApiKey `
    -ResolvedSpeechBaseUrl $resolvedSpeechBaseUrl `
    -ResolvedSpeechSttModel $resolvedSpeechSttModel `
    -ResolvedSpeechTtsModel $resolvedSpeechTtsModel `
    -ResolvedSpeechTtsVoice $resolvedSpeechTtsVoice
  Write-Host "Saved Volcengine settings to $configPath" -ForegroundColor DarkGray
}

$env:CLAUDE_CODE_USE_OPENAI = '1'
Remove-Item Env:CLAUDE_CODE_USE_OLLAMA -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_USE_CODEX -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_OPENAI_VENDOR_NAME -ErrorAction SilentlyContinue
$env:OPENAI_API_KEY = $resolvedApiKey
$env:OPENAI_BASE_URL = $resolvedBaseUrl
$env:OPENAI_MODEL = $resolvedModel

if ($speechEnabled) {
  $env:CLAUDE_CODE_USE_OPENAI_SPEECH = '1'
  if ($resolvedSpeechApiKey -eq $resolvedApiKey) {
    Remove-Item Env:OPENAI_SPEECH_API_KEY -ErrorAction SilentlyContinue
  } else {
    Set-OptionalEnvValue -Name 'OPENAI_SPEECH_API_KEY' -Value $resolvedSpeechApiKey
  }

  if ([string]::IsNullOrWhiteSpace($resolvedSpeechBaseUrl)) {
    Remove-Item Env:OPENAI_SPEECH_BASE_URL -ErrorAction SilentlyContinue
  } else {
    Set-OptionalEnvValue -Name 'OPENAI_SPEECH_BASE_URL' -Value $resolvedSpeechBaseUrl
  }

  Set-OptionalEnvValue -Name 'OPENAI_SPEECH_STT_MODEL' -Value $resolvedSpeechSttModel
  Set-OptionalEnvValue -Name 'OPENAI_SPEECH_TTS_MODEL' -Value $resolvedSpeechTtsModel
  Set-OptionalEnvValue -Name 'OPENAI_SPEECH_TTS_VOICE' -Value $resolvedSpeechTtsVoice
} else {
  foreach ($key in @(
    'CLAUDE_CODE_USE_OPENAI_SPEECH',
    'OPENAI_SPEECH_API_KEY',
    'OPENAI_SPEECH_BASE_URL',
    'OPENAI_SPEECH_STT_MODEL',
    'OPENAI_SPEECH_TTS_MODEL',
    'OPENAI_SPEECH_TTS_VOICE'
  )) {
    Remove-Item "Env:$key" -ErrorAction SilentlyContinue
  }
}

Write-Host "Starting Claude Code with Volcengine model $resolvedModel..." -ForegroundColor Cyan
& 'node' (Join-Path $root 'scripts\run-built.cjs') @ForwardArgs
