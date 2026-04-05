import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { Text } from '../../ink.js'
import { runExternalProviderCompletion, verifyExternalProviderLogin } from '../../services/api/externalProvider.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { stripSignatureBlocks } from '../../utils/messages.js'
import {
  type ExternalModelProvider,
  getExternalModelProvider,
  getExternalProviderDefaultModel,
} from '../../utils/model/externalProvider.js'

function providerDisplayName(provider: ExternalModelProvider): string {
  return provider === 'openai' ? 'OpenAI' : 'Ollama'
}

function providerSetupHint(provider: ExternalModelProvider): string {
  if (provider === 'openai') {
    return 'Set or save OPENAI_API_KEY and optionally OPENAI_MODEL / OPENAI_BASE_URL.'
  }
  return 'Make sure Ollama is running and set or save OLLAMA_BASE_URL / OLLAMA_MODEL if needed.'
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  const provider = getExternalModelProvider()
  if (!provider) {
    onDone(
      'No external provider enabled. Open /login to configure OpenAI/Ollama, or set CLAUDE_CODE_USE_OPENAI=1 / CLAUDE_CODE_USE_OLLAMA=1.',
      { display: 'system' },
    )
    return (
      <Text>
        No external provider enabled. Open /login to configure OpenAI/Ollama,
        or set CLAUDE_CODE_USE_OPENAI=1 / CLAUDE_CODE_USE_OLLAMA=1.
      </Text>
    )
  }

  const defaultModel = getExternalProviderDefaultModel(provider)
  const verification = await verifyExternalProviderLogin(provider, {
    model: defaultModel,
  })
  const providerName = providerDisplayName(provider)

  // Keep auth-dependent UI state in sync with the new credentials mode.
  context.onChangeAPIKey()
  context.setMessages(stripSignatureBlocks)
  context.setAppState(prev => ({
    ...prev,
    authVersion: prev.authVersion + 1,
  }))

  if (!verification.ok) {
    const hint = providerSetupHint(provider)
    onDone(`${providerName} login failed: ${verification.message} ${hint}`, {
      display: 'system',
    })
    return (
      <Text>
        {providerName} login failed: {verification.message} {hint}
      </Text>
    )
  }

  // Warm-up ping for the configured default model so users get a quick sanity
  // check that model inference is reachable right after /login.
  try {
    await runExternalProviderCompletion({
      provider,
      model: defaultModel,
      systemPrompt: ['You are a coding assistant.'],
      messages: [{ role: 'user', content: 'Reply with: ok' }],
      maxTokens: 16,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    onDone(
      `${providerName} connected, but model warm-up failed for "${defaultModel}": ${msg}`,
      { display: 'system' },
    )
    return (
      <Text>
        {`${providerName} connected, but model warm-up failed for "${defaultModel}": ${msg}`}
      </Text>
    )
  }

  onDone(
    `${providerName} login successful. Using model "${defaultModel}" by default.`,
    { display: 'system' },
  )
  return (
    <Text>
      {`${providerName} login successful. Using model "${defaultModel}" by default.`}
    </Text>
  )
}
