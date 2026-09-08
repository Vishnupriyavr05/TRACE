/**
 * @fileoverview LLM service facade — delegates to provider-agnostic llmClient.
 *
 * Agents and future orchestrator should prefer `ai/core/llmClient.js`.
 * This module preserves the historical import path.
 */
import * as llmClient from '../core/llmClient.js'

export const generate = llmClient.generate
export const chat = llmClient.chat
export const healthCheck = llmClient.healthCheck

export default {
  generate: llmClient.generate,
  chat: llmClient.chat,
  healthCheck: llmClient.healthCheck,
}
