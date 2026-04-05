import { useEffect, useRef } from 'react'
import { playWavBuffer } from '../services/audioPlayback.js'
import {
  isOpenAICompatibleTtsAvailable,
  synthesizeOpenAICompatibleSpeech,
} from '../services/openaiCompatibleSpeech.js'
import type { Message } from '../types/message.js'
import { getGlobalConfig } from '../utils/config.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'
import { extractTextContent, getLastAssistantMessage } from '../utils/messages.js'

const MAX_TTS_CHARS = 4_000

export function useSpeechOutput({
  messages,
  isLoading,
}: {
  messages: Message[]
  isLoading: boolean
}): void {
  const lastHandledMessageIdRef = useRef<string | null>(null)
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    if (isLoading) {
      return
    }
    if (getGlobalConfig().speechOutputEnabled !== true) {
      return
    }
    if (!isOpenAICompatibleTtsAvailable()) {
      return
    }

    const lastAssistantMessage = getLastAssistantMessage(messages)
    if (!lastAssistantMessage || lastAssistantMessage.isApiErrorMessage) {
      return
    }
    if (lastHandledMessageIdRef.current === lastAssistantMessage.uuid) {
      return
    }

    const text = extractTextContent(lastAssistantMessage.message.content, '\n\n')
      .trim()
      .slice(0, MAX_TTS_CHARS)
    if (!text) {
      return
    }

    lastHandledMessageIdRef.current = lastAssistantMessage.uuid
    playbackQueueRef.current = playbackQueueRef.current
      .catch(() => {})
      .then(async () => {
        logForDebugging(
          `[speech] Synthesizing assistant reply (${String(text.length)} chars)`,
        )
        const wav = await synthesizeOpenAICompatibleSpeech({ text })
        await playWavBuffer(wav)
      })
      .catch(error => {
        logError(error)
      })
  }, [isLoading, messages])
}
