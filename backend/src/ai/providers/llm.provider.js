/**
 * @fileoverview LLM provider interface contract (JSDoc).
 *
 * Implementations live under ai/providers/*. Provider-specific SDKs/HTTP
 * details must stay inside adapters — agents depend only on LlmClient.
 */

/**
 * @typedef {object} LlmChatMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {object} LlmChatRequest
 * @property {LlmChatMessage[]} messages
 * @property {string} [model]
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {boolean} [jsonMode]
 * @property {number} [timeoutMs]
 */

/**
 * @typedef {object} LlmChatResponse
 * @property {string} text
 * @property {string} model
 * @property {string} provider
 * @property {{ promptTokens?: number, completionTokens?: number, totalTokens?: number }} [usage]
 * @property {number} [latencyMs]
 * @property {number} [httpStatus]
 * @property {string|null} [finishReason] Provider stop reason (e.g. "length", "stop")
 * @property {object} [rateLimit]
 */

/**
 * @typedef {object} LlmProvider
 * @property {string} id
 * @property {(request: LlmChatRequest) => Promise<LlmChatResponse>} chat
 */
