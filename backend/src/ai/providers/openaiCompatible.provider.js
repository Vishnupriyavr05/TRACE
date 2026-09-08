/**
 * @fileoverview OpenAI-compatible Chat Completions provider adapter.
 * Works with OpenAI, Groq, vLLM, LocalAI, etc. via AI_BASE_URL.
 */
import {
  AiTimeoutError,
  AiProviderError,
  errorFromProviderStatus,
} from '../core/errors.js'
import {
  extractRateLimitHeaders,
  parseProviderErrorBody,
} from '../core/rateLimitHeaders.js'

/**
 * @param {object} config
 * @param {string} config.apiKey
 * @param {string} config.baseUrl
 * @param {string} config.defaultModel
 * @param {number} [config.timeoutMs]
 * @returns {import('./llm.provider.js').LlmProvider}
 */
export function createOpenAiCompatibleProvider(config) {
  const {
    apiKey,
    baseUrl,
    defaultModel,
    timeoutMs = 60000,
  } = config

  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '')

  return {
    id: 'openai_compatible',

    /**
     * @param {import('./llm.provider.js').LlmChatRequest} request
     */
    async chat(request) {
      if (!apiKey) {
        throw new AiProviderError('AI provider API key is not configured')
      }
      if (!normalizedBase) {
        throw new AiProviderError('AI provider base URL is not configured')
      }

      const model = request.model || defaultModel
      if (!model) {
        throw new AiProviderError('AI model is not configured')
      }

      const url = `${normalizedBase}/chat/completions`
      const body = {
        model,
        messages: request.messages,
        temperature:
          typeof request.temperature === 'number' ? request.temperature : 0.2,
      }

      if (typeof request.maxTokens === 'number') {
        body.max_tokens = request.maxTokens
      }

      if (request.jsonMode) {
        body.response_format = { type: 'json_object' }
      }

      const controller = new AbortController()
      const effectiveTimeout = request.timeoutMs || timeoutMs
      const timer = setTimeout(() => controller.abort(), effectiveTimeout)
      const started = Date.now()

      try {
        let response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        // Some OpenAI-compatible servers reject response_format — retry once without it.
        if (!response.ok && request.jsonMode && response.status === 400) {
          delete body.response_format
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          })
        }

        if (!response.ok) {
          let providerError = { type: null, message: null, code: null }
          try {
            const errorText = await response.text()
            providerError = parseProviderErrorBody(errorText)
          } catch {
            // ignore body parse failures
          }
          // Status semantics win: 413 = payload, 429 = rate limit. Never log auth.
          throw errorFromProviderStatus(
            response.status,
            response.headers,
            providerError,
          )
        }

        let payload
        try {
          payload = await response.json()
        } catch {
          throw new AiProviderError('AI provider returned invalid JSON')
        }

        const text = payload?.choices?.[0]?.message?.content
        if (typeof text !== 'string' || !text.trim()) {
          throw new AiProviderError('AI provider returned empty content')
        }

        const usageRaw = payload?.usage || {}
        const choice = payload?.choices?.[0]
        const finishReason =
          typeof choice?.finish_reason === 'string'
            ? choice.finish_reason
            : null
        const rateLimit = extractRateLimitHeaders(response.headers)
        return {
          text,
          model: payload?.model || model,
          provider: 'openai_compatible',
          usage: {
            promptTokens: usageRaw.prompt_tokens,
            completionTokens: usageRaw.completion_tokens,
            totalTokens: usageRaw.total_tokens,
          },
          finishReason,
          latencyMs: Date.now() - started,
          httpStatus: 200,
          rateLimit,
        }
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new AiTimeoutError('AI provider request timed out')
        }
        if (error?.isOperational) throw error
        throw new AiProviderError('AI provider request failed')
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export default {
  createOpenAiCompatibleProvider,
}
