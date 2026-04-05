import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isOpenAICompatibleTranscriptionAvailable } from '../services/openaiCompatibleSpeech.js'
import {
  getClaudeAIOAuthTokens,
  isAnthropicAuthEnabled,
} from '../utils/auth.js'

/**
 * Kill-switch check for voice mode. Returns true unless the
 * `tengu_amber_quartz_disabled` GrowthBook flag is flipped on.
 */
export function isVoiceGrowthBookEnabled(): boolean {
  return feature('VOICE_MODE')
    ? !getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_quartz_disabled', false)
    : false
}

/**
 * Returns true when at least one speech-to-text backend is available:
 * Anthropic voice_stream via OAuth, or an OpenAI-compatible transcription API.
 */
export function hasVoiceAuth(): boolean {
  if (isAnthropicAuthEnabled()) {
    const tokens = getClaudeAIOAuthTokens()
    if (tokens?.accessToken) {
      return true
    }
  }

  return isOpenAICompatibleTranscriptionAvailable()
}

export function isVoiceModeEnabled(): boolean {
  return hasVoiceAuth() && isVoiceGrowthBookEnabled()
}
