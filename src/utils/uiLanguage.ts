import { getGlobalConfig } from './config.js'
import { getSystemLocaleLanguage } from './intl.js'

function isChineseTag(value: string): boolean {
  return value === 'zh' || value.startsWith('zh-') || value.includes('_zh')
}

function getConfiguredUiLanguage(): string | undefined {
  try {
    const configured = getGlobalConfig().uiLanguage?.trim().toLowerCase()
    if (!configured || configured === 'system') {
      return undefined
    }
    return configured
  } catch {
    return undefined
  }
}

/**
 * UI language switch:
 * 1) Explicit override via CLAUDE_CODE_UI_LANG
 * 2) Saved config via /config
 * 3) POSIX locale env vars
 * 4) Intl-resolved system locale
 */
export function shouldUseChineseUi(): boolean {
  const override = process.env.CLAUDE_CODE_UI_LANG?.trim().toLowerCase()
  if (override) {
    if (isChineseTag(override)) return true
    if (
      override === 'en' ||
      override.startsWith('en-') ||
      override.includes('_en')
    ) {
      return false
    }
  }

  const configured = getConfiguredUiLanguage()
  if (configured) {
    if (isChineseTag(configured)) return true
    if (
      configured === 'en' ||
      configured.startsWith('en-') ||
      configured.includes('_en')
    ) {
      return false
    }
  }

  const localeFromEnv = (
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    ''
  )
    .trim()
    .toLowerCase()
  if (localeFromEnv && localeFromEnv.includes('zh')) {
    return true
  }

  const localeLang = getSystemLocaleLanguage()?.toLowerCase()
  return localeLang === 'zh'
}
