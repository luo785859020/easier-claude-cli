import { randomUUID } from 'crypto'
import { getGlobalConfig } from '../utils/config.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { safeParseJSON } from '../utils/json.js'
import {
  getOpenAIApiKey,
  getOpenAIBaseUrl,
} from '../utils/model/externalProvider.js'
import { jsonStringify } from '../utils/slowOperations.js'

type SpeechEnvKey =
  | 'CLAUDE_CODE_USE_OPENAI_SPEECH'
  | 'OPENAI_SPEECH_API_KEY'
  | 'OPENAI_SPEECH_BASE_URL'
  | 'OPENAI_SPEECH_STT_MODEL'
  | 'OPENAI_SPEECH_TTS_MODEL'
  | 'OPENAI_SPEECH_TTS_VOICE'

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function getStoredEnvValue(key: SpeechEnvKey): string | undefined {
  const value = getGlobalConfig().env[key]
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

function getConfiguredEnvValue(key: SpeechEnvKey): string | undefined {
  const fromProcess = process.env[key]?.trim()
  if (fromProcess && fromProcess.length > 0) {
    return fromProcess
  }
  return getStoredEnvValue(key)
}

export function isOpenAICompatibleSpeechEnabled(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI_SPEECH) ||
    isEnvTruthy(getStoredEnvValue('CLAUDE_CODE_USE_OPENAI_SPEECH')) ||
    !!getConfiguredEnvValue('OPENAI_SPEECH_STT_MODEL') ||
    !!getConfiguredEnvValue('OPENAI_SPEECH_TTS_MODEL')
  )
}

export function getOpenAICompatibleSpeechApiKey(): string | undefined {
  return getConfiguredEnvValue('OPENAI_SPEECH_API_KEY') || getOpenAIApiKey()
}

export function getOpenAICompatibleSpeechBaseUrl(): string {
  return trimTrailingSlash(
    getConfiguredEnvValue('OPENAI_SPEECH_BASE_URL') || getOpenAIBaseUrl(),
  )
}

export function getOpenAICompatibleSpeechSttModel(): string | undefined {
  return getConfiguredEnvValue('OPENAI_SPEECH_STT_MODEL')
}

export function getOpenAICompatibleSpeechTtsModel(): string | undefined {
  return getConfiguredEnvValue('OPENAI_SPEECH_TTS_MODEL')
}

export function getOpenAICompatibleSpeechTtsVoice(): string {
  return getConfiguredEnvValue('OPENAI_SPEECH_TTS_VOICE') || 'alloy'
}

export function isOpenAICompatibleTranscriptionAvailable(): boolean {
  return Boolean(
    getOpenAICompatibleSpeechApiKey() && getOpenAICompatibleSpeechSttModel(),
  )
}

export function isOpenAICompatibleTtsAvailable(): boolean {
  return Boolean(
    getOpenAICompatibleSpeechApiKey() && getOpenAICompatibleSpeechTtsModel(),
  )
}

export function buildWavFileFromPcm(
  chunks: Buffer[],
  options: { sampleRate?: number; channels?: number; bitsPerSample?: number } = {},
): Buffer {
  const sampleRate = options.sampleRate ?? 16_000
  const channels = options.channels ?? 1
  const bitsPerSample = options.bitsPerSample ?? 16
  const pcmData = Buffer.concat(chunks)
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const blockAlign = channels * (bitsPerSample / 8)
  const header = Buffer.alloc(44)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcmData.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcmData.length, 40)

  return Buffer.concat([header, pcmData])
}

function buildMultipartFormData(parts: Array<
  | { name: string; value: string }
  | {
      name: string
      filename: string
      contentType: string
      data: Buffer
    }
>): { body: Buffer; contentType: string } {
  const boundary = `----ClaudeCodeSpeech${randomUUID()}`
  const chunks: Buffer[] = []

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'))
    if ('data' in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`,
          'utf8',
        ),
      )
      chunks.push(
        Buffer.from(`Content-Type: ${part.contentType}\r\n\r\n`, 'utf8'),
      )
      chunks.push(part.data)
      chunks.push(Buffer.from('\r\n', 'utf8'))
      continue
    }

    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
        'utf8',
      ),
    )
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

export async function transcribeOpenAICompatibleSpeech(params: {
  pcmChunks: Buffer[]
  language?: string
  signal?: AbortSignal
}): Promise<string> {
  const apiKey = getOpenAICompatibleSpeechApiKey()
  const baseUrl = getOpenAICompatibleSpeechBaseUrl()
  const model = getOpenAICompatibleSpeechSttModel()

  if (!apiKey || !model) {
    throw new Error(
      'OpenAI-compatible speech transcription is not configured. Set OPENAI_SPEECH_API_KEY and OPENAI_SPEECH_STT_MODEL.',
    )
  }

  const wav = buildWavFileFromPcm(params.pcmChunks)
  const parts: Array<
    | { name: string; value: string }
    | {
        name: string
        filename: string
        contentType: string
        data: Buffer
      }
  > = [
    { name: 'model', value: model },
    { name: 'response_format', value: 'json' },
    {
      name: 'file',
      filename: 'voice-input.wav',
      contentType: 'audio/wav',
      data: wav,
    },
  ]

  const language = params.language?.trim()
  if (language) {
    parts.unshift({ name: 'language', value: language })
  }

  const { body, contentType } = buildMultipartFormData(parts)
  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': contentType,
    },
    body,
    signal: params.signal ?? AbortSignal.timeout(60_000),
  })

  const rawText = await response.text()
  if (!response.ok) {
    throw new Error(
      `[speech] Transcription request failed (${response.status}): ${rawText}`,
    )
  }

  const payload = safeParseJSON(rawText, false) as
    | { text?: unknown }
    | null
    | undefined
  const text =
    payload && typeof payload.text === 'string'
      ? payload.text.trim()
      : rawText.trim()

  return text
}

export async function synthesizeOpenAICompatibleSpeech(params: {
  text: string
  signal?: AbortSignal
}): Promise<Buffer> {
  const apiKey = getOpenAICompatibleSpeechApiKey()
  const baseUrl = getOpenAICompatibleSpeechBaseUrl()
  const model = getOpenAICompatibleSpeechTtsModel()

  if (!apiKey || !model) {
    throw new Error(
      'OpenAI-compatible speech synthesis is not configured. Set OPENAI_SPEECH_API_KEY and OPENAI_SPEECH_TTS_MODEL.',
    )
  }

  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'audio/wav',
    },
    body: jsonStringify({
      model,
      voice: getOpenAICompatibleSpeechTtsVoice(),
      input: params.text,
      response_format: 'wav',
    }),
    signal: params.signal ?? AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    const rawText = await response.text()
    throw new Error(
      `[speech] Speech synthesis request failed (${response.status}): ${rawText}`,
    )
  }

  return Buffer.from(await response.arrayBuffer())
}
