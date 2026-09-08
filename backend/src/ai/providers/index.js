/**
 * @fileoverview Provider factory — selects adapter from env configuration.
 */
import {
  AI_PROVIDER,
  AI_MODEL,
  AI_API_KEY,
  AI_BASE_URL,
  AI_TIMEOUT_MS,
} from '../../config/environment/env.js'
import { AiConfigError } from '../core/errors.js'
import { createOpenAiCompatibleProvider } from './openaiCompatible.provider.js'

/**
 * @returns {import('./llm.provider.js').LlmProvider}
 */
export function getLlmProvider() {
  const provider = String(AI_PROVIDER || 'openai_compatible').toLowerCase()

  if (!AI_API_KEY) {
    throw new AiConfigError(
      'AI_API_KEY is not configured. Set AI environment variables to enable the Planner.'
    )
  }
  if (!AI_MODEL) {
    throw new AiConfigError(
      'AI_MODEL is not configured. Set AI_MODEL to enable the Planner.'
    )
  }
  if (!AI_BASE_URL) {
    throw new AiConfigError(
      'AI_BASE_URL is not configured. Set AI_BASE_URL for the OpenAI-compatible provider.'
    )
  }

  if (
    provider === 'openai_compatible' ||
    provider === 'openai' ||
    provider === 'openai-compatible'
  ) {
    return createOpenAiCompatibleProvider({
      apiKey: AI_API_KEY,
      baseUrl: AI_BASE_URL,
      defaultModel: AI_MODEL,
      timeoutMs: AI_TIMEOUT_MS,
    })
  }

  throw new AiConfigError(
    `Unsupported AI_PROVIDER "${AI_PROVIDER}". Use openai_compatible.`
  )
}

/**
 * Safe metadata for logs / activity (never includes secrets).
 *
 * @returns {{ provider: string, model: string, baseUrlHost: string|null }}
 */
export function getSafeAiMeta() {
  let host = null
  try {
    host = AI_BASE_URL ? new URL(AI_BASE_URL).host : null
  } catch {
    host = null
  }
  return {
    provider: String(AI_PROVIDER || 'openai_compatible'),
    model: AI_MODEL || null,
    baseUrlHost: host,
  }
}

export default {
  getLlmProvider,
  getSafeAiMeta,
}
