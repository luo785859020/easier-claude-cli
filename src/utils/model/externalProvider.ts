import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { isEnvTruthy } from '../envUtils.js'

export type ExternalModelProvider = 'openai' | 'ollama'
type ExternalProviderEnvKey =
  | 'CLAUDE_CODE_USE_OPENAI'
  | 'CLAUDE_CODE_USE_OLLAMA'
  | 'OPENAI_API_KEY'
  | 'OPENAI_BASE_URL'
  | 'OPENAI_MODEL'
  | 'OLLAMA_API_KEY'
  | 'OLLAMA_BASE_URL'
  | 'OLLAMA_MODEL'

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function getStoredEnvValue(key: ExternalProviderEnvKey): string | undefined {
  const value = getGlobalConfig().env[key]
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

function getConfiguredEnvValue(key: ExternalProviderEnvKey): string | undefined {
  const fromProcess = process.env[key]?.trim()
  if (fromProcess && fromProcess.length > 0) {
    return fromProcess
  }
  return getStoredEnvValue(key)
}

function isConfiguredTruthyFlag(key: ExternalProviderEnvKey): boolean {
  return isEnvTruthy(process.env[key]) || isEnvTruthy(getStoredEnvValue(key))
}

export function persistExternalProviderEnv(
  updates: Partial<Record<ExternalProviderEnvKey, string | undefined>>,
): void {
  saveGlobalConfig(current => {
    const nextEnv = { ...current.env }
    for (const [key, rawValue] of Object.entries(updates) as Array<
      [ExternalProviderEnvKey, string | undefined]
    >) {
      const value = rawValue?.trim()
      if (value && value.length > 0) {
        nextEnv[key] = value
        process.env[key] = value
      } else {
        delete nextEnv[key]
        delete process.env[key]
      }
    }
    return {
      ...current,
      env: nextEnv,
    }
  })
}

export function saveOpenAIProviderConfig(config: {
  apiKey?: string
  baseUrl?: string
  model?: string
}): void {
  persistExternalProviderEnv({
    CLAUDE_CODE_USE_OPENAI: '1',
    CLAUDE_CODE_USE_OLLAMA: undefined,
    OPENAI_API_KEY: config.apiKey,
    OPENAI_BASE_URL: config.baseUrl,
    OPENAI_MODEL: config.model,
  })
}

export function saveOllamaProviderConfig(config: {
  apiKey?: string
  baseUrl?: string
  model?: string
}): void {
  persistExternalProviderEnv({
    CLAUDE_CODE_USE_OPENAI: undefined,
    CLAUDE_CODE_USE_OLLAMA: '1',
    OLLAMA_API_KEY: config.apiKey,
    OLLAMA_BASE_URL: config.baseUrl,
    OLLAMA_MODEL: config.model,
  })
}

export function getExternalModelProvider(): ExternalModelProvider | null {
  if (isConfiguredTruthyFlag('CLAUDE_CODE_USE_OPENAI')) {
    return 'openai'
  }
  if (isConfiguredTruthyFlag('CLAUDE_CODE_USE_OLLAMA')) {
    return 'ollama'
  }
  return null
}

export function isExternalModelProviderEnabled(): boolean {
  return getExternalModelProvider() !== null
}

export function getOpenAIBaseUrl(): string {
  return trimTrailingSlash(
    getConfiguredEnvValue('OPENAI_BASE_URL') || 'https://api.openai.com/v1',
  )
}

export function getOpenAIApiKey(): string | undefined {
  return getConfiguredEnvValue('OPENAI_API_KEY')
}

export function getOllamaBaseUrl(): string {
  return trimTrailingSlash(
    getConfiguredEnvValue('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434/v1',
  )
}

export function getOllamaApiKey(): string | undefined {
  return getConfiguredEnvValue('OLLAMA_API_KEY')
}

export function getExternalProviderBaseUrl(
  provider: ExternalModelProvider,
): string {
  return provider === 'openai' ? getOpenAIBaseUrl() : getOllamaBaseUrl()
}

export function getExternalProviderApiKey(
  provider: ExternalModelProvider,
): string | undefined {
  return provider === 'openai' ? getOpenAIApiKey() : getOllamaApiKey()
}

export function getExternalProviderDefaultModel(
  provider: ExternalModelProvider,
): string {
  const configuredModel =
    provider === 'openai'
      ? getConfiguredEnvValue('OPENAI_MODEL')
      : getConfiguredEnvValue('OLLAMA_MODEL')
  if (configuredModel) {
    return configuredModel
  }
  return provider === 'openai' ? 'gpt-4.1-mini' : 'qwen2.5-coder:7b'
}
