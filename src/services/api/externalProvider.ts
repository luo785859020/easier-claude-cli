import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { safeParseJSON } from 'src/utils/json.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import {
  type ExternalModelProvider,
  getExternalProviderApiKey,
  getExternalProviderBaseUrl,
} from 'src/utils/model/externalProvider.js'

type OpenAIRole = 'system' | 'user' | 'assistant' | 'tool'

type OpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type OpenAIChatMessage = {
  role: OpenAIRole
  content: string | null
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
}

type OpenAIToolSchema = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

type OpenAICompletionChoice = {
  finish_reason?: string | null
  message?: {
    content?: unknown
    tool_calls?: Array<{
      id?: string
      type?: string
      function?: {
        name?: string
        arguments?: string
      }
    }>
  }
}

type OpenAICompletionResponse = {
  choices?: OpenAICompletionChoice[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const item of value) {
      if (typeof item === 'string') {
        parts.push(item)
        continue
      }
      if (isRecord(item) && typeof item.text === 'string') {
        parts.push(item.text)
      }
    }
    return parts.join('\n')
  }
  return ''
}

function normalizeContentBlockToText(block: unknown): string {
  if (!isRecord(block)) return ''
  if (typeof block.text === 'string') return block.text
  if (typeof block.thinking === 'string') return block.thinking
  if (typeof block.content === 'string') return block.content
  if (block.type === 'tool_result') {
    return normalizeToolResultContent(block.content)
  }
  return ''
}

function normalizeToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(item => {
      if (typeof item === 'string') return item
      return normalizeContentBlockToText(item)
    })
    .filter(Boolean)
    .join('\n')
}

function extractRoleAndContent(
  input: unknown,
): { role: 'user' | 'assistant'; content: unknown } | null {
  if (!isRecord(input)) return null
  if (isRecord(input.message) && typeof input.message.role === 'string') {
    const role = input.message.role
    if (role === 'user' || role === 'assistant') {
      return { role, content: input.message.content }
    }
    return null
  }
  if (typeof input.role === 'string') {
    const role = input.role
    if (role === 'user' || role === 'assistant') {
      return { role, content: input.content }
    }
  }
  return null
}

function convertAssistantContentToOpenAI(content: unknown): OpenAIChatMessage[] {
  if (typeof content === 'string') {
    return [{ role: 'assistant', content }]
  }
  if (!Array.isArray(content)) {
    return [{ role: 'assistant', content: '' }]
  }

  const textParts: string[] = []
  const toolCalls: OpenAIToolCall[] = []

  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
      continue
    }
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      const toolId =
        typeof block.id === 'string' && block.id.length > 0
          ? block.id
          : randomUUID()
      const args = isRecord(block.input) ? block.input : {}
      toolCalls.push({
        id: toolId,
        type: 'function',
        function: {
          name: block.name,
          arguments: jsonStringify(args),
        },
      })
    }
  }

  const assistantMessage: OpenAIChatMessage = {
    role: 'assistant',
    content: textParts.join('\n\n'),
  }
  if (toolCalls.length > 0) {
    assistantMessage.tool_calls = toolCalls
  }

  return [assistantMessage]
}

function convertUserContentToOpenAI(content: unknown): OpenAIChatMessage[] {
  if (typeof content === 'string') {
    return [{ role: 'user', content }]
  }
  if (!Array.isArray(content)) {
    return [{ role: 'user', content: '' }]
  }

  const messages: OpenAIChatMessage[] = []
  const textParts: string[] = []

  const flushUserText = () => {
    if (textParts.length === 0) return
    messages.push({
      role: 'user',
      content: textParts.join('\n\n'),
    })
    textParts.length = 0
  }

  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
      continue
    }
    if (block.type === 'tool_result') {
      flushUserText()
      const toolCallId =
        typeof block.tool_use_id === 'string' && block.tool_use_id.length > 0
          ? block.tool_use_id
          : randomUUID()
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: normalizeToolResultContent(block.content) || '(empty tool result)',
      })
      continue
    }
    const fallback = normalizeContentBlockToText(block)
    if (fallback) {
      textParts.push(fallback)
    }
  }

  flushUserText()
  return messages
}

function convertMessagesToOpenAI(messages: unknown[]): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = []
  for (const rawMessage of messages) {
    const parsed = extractRoleAndContent(rawMessage)
    if (!parsed) continue
    if (parsed.role === 'assistant') {
      out.push(...convertAssistantContentToOpenAI(parsed.content))
    } else {
      out.push(...convertUserContentToOpenAI(parsed.content))
    }
  }
  return out
}

function convertToolSchemas(tools: unknown[]): OpenAIToolSchema[] {
  const out: OpenAIToolSchema[] = []
  for (const tool of tools) {
    if (!isRecord(tool)) continue
    if (typeof tool.name !== 'string' || tool.name.length === 0) continue
    if (tool.type === 'advisor_20260301') continue

    const toolSchema: OpenAIToolSchema = {
      type: 'function',
      function: {
        name: tool.name,
      },
    }

    if (typeof tool.description === 'string' && tool.description.length > 0) {
      toolSchema.function.description = tool.description
    }
    if (isRecord(tool.input_schema)) {
      toolSchema.function.parameters = tool.input_schema
    } else {
      toolSchema.function.parameters = {
        type: 'object',
        properties: {},
      }
    }
    out.push(toolSchema)
  }
  return out
}

function convertToolChoice(
  toolChoice: unknown,
): 'auto' | 'none' | { type: 'function'; function: { name: string } } | undefined {
  if (!isRecord(toolChoice)) return undefined
  const type = typeof toolChoice.type === 'string' ? toolChoice.type : ''
  if (type === 'auto' || type === 'any') return 'auto'
  if (type === 'none') return 'none'
  if (type === 'tool' && typeof toolChoice.name === 'string') {
    return {
      type: 'function',
      function: { name: toolChoice.name },
    }
  }
  return undefined
}

function convertChoiceToAnthropicContent(
  choice: OpenAICompletionChoice | undefined,
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = []
  const message = choice?.message
  if (message) {
    const text = normalizeText(message.content)
    if (text) {
      blocks.push({
        type: 'text',
        text,
      })
    }
    for (const toolCall of message.tool_calls ?? []) {
      const toolName = toolCall.function?.name
      if (!toolName) continue
      const rawArgs = toolCall.function?.arguments ?? '{}'
      const parsedArgs = safeParseJSON(rawArgs)
      const input =
        parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)
          ? (parsedArgs as Record<string, unknown>)
          : { _raw: rawArgs }

      blocks.push({
        type: 'tool_use',
        id: toolCall.id || randomUUID(),
        name: toolName,
        input,
      })
    }
  }
  if (blocks.length === 0) {
    blocks.push({
      type: 'text',
      text: '',
    })
  }
  return blocks
}

function mapFinishReasonToStopReason(
  finishReason: string | null | undefined,
  hasToolCalls: boolean,
): 'tool_use' | 'end_turn' | 'max_tokens' {
  if (hasToolCalls) return 'tool_use'
  if (finishReason === 'length') return 'max_tokens'
  return 'end_turn'
}

export type ExternalProviderCompletionResult = {
  contentBlocks: Array<Record<string, unknown>>
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  stopReason: 'tool_use' | 'end_turn' | 'max_tokens'
}

export async function runExternalProviderCompletion(params: {
  provider: ExternalModelProvider
  model: string
  messages: unknown[]
  systemPrompt: string[]
  tools?: unknown[]
  toolChoice?: unknown
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}): Promise<ExternalProviderCompletionResult> {
  const baseUrl = getExternalProviderBaseUrl(params.provider)
  const apiKey = getExternalProviderApiKey(params.provider)
  const endpoint = `${baseUrl}/chat/completions`
  const signal = params.signal ?? AbortSignal.timeout(20_000)

  if (params.provider === 'openai' && !apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1',
    )
  }

  const openAIMessages: OpenAIChatMessage[] = []
  const systemText = params.systemPrompt.filter(Boolean).join('\n\n')
  if (systemText.length > 0) {
    openAIMessages.push({
      role: 'system',
      content: systemText,
    })
  }
  openAIMessages.push(...convertMessagesToOpenAI(params.messages))

  const payload: Record<string, unknown> = {
    model: params.model,
    messages: openAIMessages,
    stream: false,
  }
  if (params.temperature !== undefined) {
    payload.temperature = params.temperature
  }
  if (params.maxTokens !== undefined) {
    payload.max_tokens = params.maxTokens
  }
  const convertedTools = convertToolSchemas(params.tools ?? [])
  if (convertedTools.length > 0) {
    payload.tools = convertedTools
    const convertedToolChoice = convertToolChoice(params.toolChoice)
    if (convertedToolChoice !== undefined) {
      payload.tool_choice = convertedToolChoice
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: jsonStringify(payload),
    signal,
  })

  const rawText = await response.text()
  if (!response.ok) {
    throw new Error(
      `[${params.provider}] API request failed (${response.status}): ${rawText}`,
    )
  }

  const raw = safeParseJSON(rawText) as OpenAICompletionResponse | null
  if (!raw) {
    throw new Error(`[${params.provider}] Invalid JSON response from provider`)
  }

  const choice = raw.choices?.[0]
  const contentBlocks = convertChoiceToAnthropicContent(choice)
  const toolCalls = choice?.message?.tool_calls
  const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0

  return {
    contentBlocks,
    usage: {
      input_tokens: raw.usage?.prompt_tokens ?? 0,
      output_tokens: raw.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    stopReason: mapFinishReasonToStopReason(choice?.finish_reason, hasToolCalls),
  }
}

async function fetchWithOptionalAuth(
  url: string,
  apiKey: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return fetch(url, { headers })
}

function extractModelNames(payload: unknown): string[] {
  const models: string[] = []
  if (!isRecord(payload)) {
    return models
  }
  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      if (!isRecord(item)) continue
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      if (id) models.push(id)
    }
  }
  if (Array.isArray(payload.models)) {
    for (const item of payload.models) {
      if (!isRecord(item)) continue
      const name =
        typeof item.name === 'string'
          ? item.name.trim()
          : typeof item.id === 'string'
            ? item.id.trim()
            : ''
      if (name) models.push(name)
    }
  }
  return [...new Set(models)]
}

export async function listExternalProviderModels(
  provider: ExternalModelProvider,
): Promise<{ ok: boolean; models: string[]; message: string }> {
  const baseUrl = getExternalProviderBaseUrl(provider)
  const apiKey = getExternalProviderApiKey(provider)

  if (provider === 'openai' && !apiKey) {
    return {
      ok: false,
      models: [],
      message: 'Missing OPENAI_API_KEY environment variable.',
    }
  }

  const openAIModelsUrl = `${baseUrl}/models`
  const primary = await fetchWithOptionalAuth(openAIModelsUrl, apiKey).catch(
    () => null,
  )

  if (primary && primary.ok) {
    const payload = safeParseJSON(await primary.text(), false)
    const models = extractModelNames(payload).sort((a, b) =>
      a.localeCompare(b),
    )
    if (models.length > 0) {
      return {
        ok: true,
        models,
        message: `Fetched ${models.length} models from ${openAIModelsUrl}`,
      }
    }
  }

  if (provider === 'ollama') {
    const nativeBase = baseUrl.replace(/\/v1$/, '')
    const tagsUrl = `${nativeBase}/api/tags`
    const fallback = await fetch(tagsUrl).catch(() => null)
    if (fallback && fallback.ok) {
      const payload = safeParseJSON(await fallback.text(), false)
      const models = extractModelNames(payload).sort((a, b) =>
        a.localeCompare(b),
      )
      if (models.length > 0) {
        return {
          ok: true,
          models,
          message: `Fetched ${models.length} models from ${tagsUrl}`,
        }
      }
    }
  }

  const status = primary ? `${primary.status}` : 'network_error'
  return {
    ok: false,
    models: [],
    message: `Unable to fetch available ${provider} models (status=${status}).`,
  }
}

export async function listCodexCliModels(): Promise<{
  ok: boolean
  models: string[]
  message: string
}> {
  const modelsCachePath = join(homedir(), '.codex', 'models_cache.json')
  const raw = await readFile(modelsCachePath, 'utf8').catch(() => null)
  if (!raw) {
    return {
      ok: false,
      models: [],
      message: `Codex model cache not found at ${modelsCachePath}.`,
    }
  }

  const parsed = safeParseJSON(raw, false)
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    return {
      ok: false,
      models: [],
      message: 'Codex model cache has an unexpected format.',
    }
  }

  const withPriority: Array<{ slug: string; priority: number }> = []
  for (const item of parsed.models) {
    if (!isRecord(item)) continue
    if (item.visibility !== 'list') continue
    if (typeof item.slug !== 'string' || item.slug.trim().length === 0) continue
    const priority =
      typeof item.priority === 'number' && Number.isFinite(item.priority)
        ? item.priority
        : Number.MAX_SAFE_INTEGER
    withPriority.push({
      slug: item.slug.trim(),
      priority,
    })
  }

  const models = [...new Set(withPriority
    .sort((a, b) => a.priority - b.priority)
    .map(item => item.slug))]

  if (models.length === 0) {
    return {
      ok: false,
      models: [],
      message: 'No visible models found in Codex model cache.',
    }
  }

  return {
    ok: true,
    models,
    message: `Loaded ${models.length} models from ${modelsCachePath}.`,
  }
}

export async function verifyExternalProviderLogin(
  provider: ExternalModelProvider,
  options?: { model?: string },
): Promise<{ ok: boolean; message: string }> {
  const baseUrl = getExternalProviderBaseUrl(provider)
  const apiKey = getExternalProviderApiKey(provider)

  if (provider === 'openai' && !apiKey) {
    return {
      ok: false,
      message: 'Missing OPENAI_API_KEY environment variable.',
    }
  }

  const openAIModelsUrl = `${baseUrl}/models`
  const primary = await fetchWithOptionalAuth(openAIModelsUrl, apiKey).catch(
    () => null,
  )
  if (primary && primary.ok) {
    return {
      ok: true,
      message:
        provider === 'openai'
          ? `OpenAI login verified via ${openAIModelsUrl}`
          : `Ollama connection verified via ${openAIModelsUrl}`,
    }
  }

  if (provider === 'ollama') {
    // Ollama native endpoint fallback
    const nativeBase = baseUrl.replace(/\/v1$/, '')
    const tagsUrl = `${nativeBase}/api/tags`
    const fallback = await fetch(tagsUrl).catch(() => null)
    if (fallback && fallback.ok) {
      return {
        ok: true,
        message: `Ollama connection verified via ${tagsUrl}`,
      }
    }
  }

  const status = primary ? `${primary.status}` : 'network_error'
  if (provider === 'openai' && options?.model?.trim()) {
    return {
      ok: true,
      message: `Model list endpoint unavailable (status=${status}). Continuing with direct model verification for "${options.model.trim()}".`,
    }
  }
  return {
    ok: false,
    message: `Unable to verify ${provider} credentials/endpoint (status=${status}).`,
  }
}
