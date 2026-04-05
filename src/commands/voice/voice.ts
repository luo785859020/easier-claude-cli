import { normalizeLanguageForSTT } from '../../hooks/useVoice.js'
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js'
import { logEvent } from '../../services/analytics/index.js'
import {
  isOpenAICompatibleTranscriptionAvailable,
} from '../../services/openaiCompatibleSpeech.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import { isVoiceModeEnabled } from '../../voice/voiceModeEnabled.js'

const LANG_HINT_MAX_SHOWS = 2

function getVoiceUnavailableMessage(): string {
  if (isOpenAICompatibleTranscriptionAvailable()) {
    return 'Voice mode is not available.'
  }
  return (
    'Voice mode requires either a Claude.ai login or an OpenAI-compatible speech provider. ' +
    'Configure OPENAI_SPEECH_API_KEY / OPENAI_SPEECH_BASE_URL / OPENAI_SPEECH_STT_MODEL, or run /login.'
  )
}

export const call: LocalCommandCall = async () => {
  if (!isVoiceModeEnabled()) {
    return {
      type: 'text' as const,
      value: getVoiceUnavailableMessage(),
    }
  }

  const currentSettings = getInitialSettings()
  const isCurrentlyEnabled = currentSettings.voiceEnabled === true

  if (isCurrentlyEnabled) {
    const result = updateSettingsForSource('userSettings', {
      voiceEnabled: false,
    })
    if (result.error) {
      return {
        type: 'text' as const,
        value:
          'Failed to update settings. Check your settings file for syntax errors.',
      }
    }
    settingsChangeDetector.notifyChange('userSettings')
    logEvent('tengu_voice_toggled', { enabled: false })
    return {
      type: 'text' as const,
      value: 'Voice mode disabled.',
    }
  }

  const { isVoiceStreamAvailable } = await import(
    '../../services/voiceStreamSTT.js'
  )
  const {
    checkRecordingAvailability,
    checkVoiceDependencies,
    requestMicrophonePermission,
  } = await import('../../services/voice.js')

  const recording = await checkRecordingAvailability()
  if (!recording.available) {
    return {
      type: 'text' as const,
      value:
        recording.reason ?? 'Voice mode is not available in this environment.',
    }
  }

  if (
    !isVoiceStreamAvailable() &&
    !isOpenAICompatibleTranscriptionAvailable()
  ) {
    return {
      type: 'text' as const,
      value: getVoiceUnavailableMessage(),
    }
  }

  const deps = await checkVoiceDependencies()
  if (!deps.available) {
    const hint = deps.installCommand
      ? `\nInstall audio recording tools? Run: ${deps.installCommand}`
      : '\nInstall SoX manually for audio recording.'
    return {
      type: 'text' as const,
      value: `No audio recording tool found.${hint}`,
    }
  }

  if (!(await requestMicrophonePermission())) {
    let guidance: string
    if (process.platform === 'win32') {
      guidance = 'Settings -> Privacy -> Microphone'
    } else if (process.platform === 'linux') {
      guidance = "your system's audio settings"
    } else {
      guidance = 'System Settings -> Privacy & Security -> Microphone'
    }
    return {
      type: 'text' as const,
      value: `Microphone access is denied. To enable it, go to ${guidance}, then run /voice again.`,
    }
  }

  const result = updateSettingsForSource('userSettings', { voiceEnabled: true })
  if (result.error) {
    return {
      type: 'text' as const,
      value:
        'Failed to update settings. Check your settings file for syntax errors.',
    }
  }

  settingsChangeDetector.notifyChange('userSettings')
  logEvent('tengu_voice_toggled', { enabled: true })
  const key = getShortcutDisplay('voice:pushToTalk', 'Chat', 'Space')
  const stt = normalizeLanguageForSTT(currentSettings.language)
  const cfg = getGlobalConfig()
  const langChanged = cfg.voiceLangHintLastLanguage !== stt.code
  const priorCount = langChanged ? 0 : (cfg.voiceLangHintShownCount ?? 0)
  const showHint = !stt.fellBackFrom && priorCount < LANG_HINT_MAX_SHOWS
  let langNote = ''
  if (stt.fellBackFrom) {
    langNote = ` Note: "${stt.fellBackFrom}" is not a supported dictation language; using English. Change it via /config.`
  } else if (showHint) {
    langNote = ` Dictation language: ${stt.code} (/config to change).`
  }
  if (langChanged || showHint) {
    saveGlobalConfig(prev => ({
      ...prev,
      voiceLangHintShownCount: priorCount + (showHint ? 1 : 0),
      voiceLangHintLastLanguage: stt.code,
    }))
  }
  return {
    type: 'text' as const,
    value: `Voice mode enabled. Hold ${key} to record.${langNote}`,
  }
}
