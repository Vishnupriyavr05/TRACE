/**
 * @fileoverview Reusable agent execution contract.
 *
 * Input → validate → prompt → LLM → parse → validate output → result
 *
 * Agents never call other agents. Orchestrator (future) owns sequencing.
 */
import { chat } from './llmClient.js'
import { parseStructuredJson } from './jsonRepair.js'
import { createRunId } from './runId.js'
import { AiOutputError } from './errors.js'
import { AppError } from '../../utils/AppError.js'
import { getSafeAiMeta } from '../providers/index.js'

/**
 * @typedef {object} AgentDefinition
 * @property {string} id
 * @property {(input: object) => { ok: boolean, errors?: string[], value?: object }} validateInput
 * @property {(input: object) => { system: string, user: string }} buildMessages
 * @property {(raw: unknown) => { ok: boolean, errors?: string[], value?: object }} validateOutput
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {boolean} [jsonMode]
 */

/**
 * Execute one agent turn under the TRACE AI contract.
 *
 * @param {AgentDefinition} agent
 * @param {object} input
 * @param {{ runId?: string }} [options]
 * @returns {Promise<{
 *   runId: string,
 *   agent: string,
 *   output: object,
 *   meta: object
 * }>}
 */
export async function runAgent(agent, input, options = {}) {
  const runId = options.runId || createRunId()
  const startedAt = new Date()

  const inputResult = agent.validateInput(input)
  if (!inputResult.ok) {
    throw new AppError(
      'Invalid agent input',
      400,
      inputResult.errors || ['Input validation failed']
    )
  }

  const validatedInput = inputResult.value
  const prompts = agent.buildMessages(validatedInput)

  const llmResult = await chat(
    {
      messages: [
        { role: 'system', content: prompts.system },
        { role: 'user', content: prompts.user },
      ],
      temperature: agent.temperature ?? 0.2,
      maxTokens: agent.maxTokens ?? 2048,
      jsonMode: agent.jsonMode !== false,
    },
    { agent: agent.id, runId }
  )

  let parsed
  try {
    parsed = parseStructuredJson(llmResult.text)
  } catch (error) {
    const finishReason =
      typeof llmResult.finishReason === 'string'
        ? llmResult.finishReason
        : null
    const details = [error?.message || 'JSON parse failed']
    if (finishReason) {
      details.push(`finishReason=${finishReason}`)
    }
    if (finishReason === 'length') {
      throw new AiOutputError('AI output truncated at token limit', details)
    }
    throw new AiOutputError('AI returned invalid JSON', details)
  }

  const outputResult = agent.validateOutput(parsed)
  if (!outputResult.ok) {
    throw new AiOutputError(
      'AI output failed schema validation',
      outputResult.errors || ['Schema validation failed']
    )
  }

  const endedAt = new Date()
  return {
    runId,
    agent: agent.id,
    output: outputResult.value,
    meta: {
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      success: true,
      model: llmResult.model,
      provider: llmResult.provider || getSafeAiMeta().provider,
      usage: llmResult.usage || null,
    },
  }
}

export default {
  runAgent,
}
