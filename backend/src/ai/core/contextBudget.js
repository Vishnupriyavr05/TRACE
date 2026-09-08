/**
 * @fileoverview Central TRACE LLM context budgeting.
 * Measure → compact (deterministic, provenance-preserving) → re-measure.
 * Never send oversized requests to the provider.
 */
import { NODE_ENV } from '../../config/environment/env.js'
import {
  AiContextBudgetError,
  getAgentTokenBudget,
  getProviderTpmConfig,
  getTraceProfile,
  normalizeAgentId,
} from './traceProfile.js'
import {
  recordContextBudgetEvent,
  getProviderTpmHeadroom,
} from './llmAccounting.js'

/** Keys that must survive compaction when present. */
export const PROVENANCE_KEYS = Object.freeze([
  'paperId',
  'paperIds',
  'evidenceId',
  'evidenceIds',
  'nodeId',
  'nodeIds',
  'findingId',
  'id',
  'citation',
  'relevance',
  'source',
  'providers',
  'doi',
  'url',
  'year',
  'confidence',
  'handling',
  'recommendedHandling',
  'confidenceCeiling',
  'type',
  'status',
  'support',
])

/**
 * Conservative multiplier so chars/4 preflight does not under-estimate
 * provider token usage (observed Critic: 4275 est → 4663 actual ≈ 1.09).
 */
export const INPUT_TOKEN_ESTIMATE_SAFETY_MULTIPLIER = 1.1

/**
 * @param {number} chars
 * @returns {number}
 */
export function estimateTokensFromChars(chars) {
  const n = Number(chars) || 0
  return Math.max(
    0,
    Math.ceil((n / 4) * INPUT_TOKEN_ESTIMATE_SAFETY_MULTIPLIER),
  )
}

/**
 * @param {{ role?: string, content?: string }[]} messages
 * @returns {number}
 */
export function measureSerializedChars(messages = []) {
  let total = 0
  for (const msg of messages || []) {
    total += String(msg?.content || '').length
  }
  return total
}

/**
 * @param {{ role?: string, content?: string }[]} messages
 * @param {{ maxTokens?: number, agent?: string, runId?: string }} [meta]
 * @returns {object}
 */
export function measureChatRequest(messages, meta = {}) {
  const budget = getAgentTokenBudget(meta.agent)
  const serializedChars = measureSerializedChars(messages)
  const estimatedInputTokens = estimateTokensFromChars(serializedChars)
  const requestedOutputTokens =
    typeof meta.maxTokens === 'number' && meta.maxTokens > 0
      ? meta.maxTokens
      : budget.maxOutputTokens
  const projectedTotalTokens = estimatedInputTokens + requestedOutputTokens
  const tpm = getProviderTpmConfig()
  const headroom = tpm.enabled ? getProviderTpmHeadroom() : null
  const providerTpmRemaining = headroom?.remainingTokens ?? null
  const tpmWithinBudget =
    providerTpmRemaining == null ||
    projectedTotalTokens <= providerTpmRemaining
  const withinInputBudget = estimatedInputTokens <= budget.maxInputTokens
  return {
    agent: normalizeAgentId(meta.agent),
    runId: meta.runId || null,
    serializedChars,
    estimatedInputTokens,
    requestedOutputTokens,
    maxInputTokens: budget.maxInputTokens,
    maxOutputTokens: budget.maxOutputTokens,
    projectedTotalTokens,
    providerTpmRemaining,
    tpmWithinBudget,
    withinInputBudget,
    withinBudget: withinInputBudget && tpmWithinBudget,
  }
}

/**
 * @param {string} event
 * @param {object} meta
 */
export function logContextBudget(event, meta = {}) {
  const safe = {
    agent: meta.agent,
    runId: meta.runId,
    serializedChars: meta.serializedChars,
    estimatedInputTokens: meta.estimatedInputTokens,
    maxInputTokens: meta.maxInputTokens,
    requestedOutputTokens: meta.requestedOutputTokens,
    projectedTotalTokens: meta.projectedTotalTokens,
    budgetAction: meta.budgetAction,
    compactionLevel: meta.compactionLevel,
    withinBudget: meta.withinBudget,
  }
  if (NODE_ENV === 'production') {
    console.info('[AI]', event, safe)
    return
  }
  console.info('[AI]', event, safe)
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  const value = typeof text === 'string' ? text : String(text || '')
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

/**
 * Compact a single evidence/paper-like record; keep provenance fields.
 *
 * @param {object} item
 * @param {{ abstractChars?: number, titleChars?: number, dropExtras?: boolean }} opts
 * @returns {object}
 */
export function compactEvidenceRecord(item, opts = {}) {
  if (!item || typeof item !== 'object') return item
  const abstractChars = opts.abstractChars ?? 120
  const titleChars = opts.titleChars ?? 160
  const out = {
    evidenceId: item.evidenceId ?? undefined,
    paperId: item.paperId ?? undefined,
    title: truncate(item.title || '', titleChars),
    abstract: truncate(item.abstract || item.shortAbstract || '', abstractChars),
    citation: item.citation ?? undefined,
    relevance: typeof item.relevance === 'number' ? item.relevance : null,
    source: item.source ?? item.provenance?.source ?? null,
    providers: Array.isArray(item.providers)
      ? item.providers.slice(0, 4)
      : Array.isArray(item.provenance?.providers)
        ? item.provenance.providers.slice(0, 4)
        : undefined,
    nodeId: item.nodeId || item.provenance?.nodeId || null,
    year: item.year ?? null,
    doi: item.doi ?? null,
  }
  if (!opts.dropExtras) {
    if (item.venue) out.venue = truncate(item.venue, 60)
    if (Array.isArray(item.keywords)) out.keywords = item.keywords.slice(0, 4)
    if (Array.isArray(item.matchedQueries)) {
      out.matchedQueries = item.matchedQueries.slice(0, 2)
    }
  }
  // Strip undefined
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key]
  }
  return out
}

/**
 * Compact finding-like objects while preserving IDs and evidence links.
 *
 * @param {object} finding
 * @param {{ statementChars?: number }} [opts]
 * @returns {object}
 */
export function compactFindingRecord(finding, opts = {}) {
  if (!finding || typeof finding !== 'object') return finding
  const statementChars = opts.statementChars ?? 280
  return {
    id: finding.id,
    findingId: finding.findingId,
    statement: truncate(
      finding.statement || finding.text || finding.saferInterpretation || '',
      statementChars,
    ),
    type: finding.type,
    confidence: finding.confidence,
    handling: finding.handling || finding.recommendedHandling,
    confidenceCeiling: finding.confidenceCeiling,
    evidenceIds: Array.isArray(finding.evidenceIds)
      ? finding.evidenceIds.slice(0, 8)
      : [],
    paperIds: Array.isArray(finding.paperIds) ? finding.paperIds.slice(0, 8) : [],
    support: finding.support,
  }
}

/**
 * @param {object} gap
 * @returns {object}
 */
export function compactGapRecord(gap) {
  if (!gap || typeof gap !== 'object') {
    return typeof gap === 'string' ? { description: truncate(gap, 200) } : gap
  }
  return {
    id: gap.id,
    description: truncate(gap.description || gap.message || gap.text || '', 200),
    evidenceIds: Array.isArray(gap.evidenceIds) ? gap.evidenceIds.slice(0, 6) : [],
    paperIds: Array.isArray(gap.paperIds) ? gap.paperIds.slice(0, 6) : [],
    relatedFindingIds: Array.isArray(gap.relatedFindingIds)
      ? gap.relatedFindingIds.slice(0, 6)
      : undefined,
    requirementId: gap.requirementId || gap.basedOnRequirement || undefined,
    severity: gap.severity,
    type: gap.type,
  }
}

/**
 * @param {object} contradiction
 * @returns {object}
 */
export function compactContradictionRecord(contradiction) {
  if (!contradiction || typeof contradiction !== 'object') {
    return typeof contradiction === 'string'
      ? { statement: truncate(contradiction, 200) }
      : contradiction
  }
  return {
    id: contradiction.id,
    statement: truncate(
      contradiction.statement || contradiction.description || '',
      220,
    ),
    evidenceIds: Array.isArray(contradiction.evidenceIds)
      ? contradiction.evidenceIds.slice(0, 6)
      : [],
    paperIds: Array.isArray(contradiction.paperIds)
      ? contradiction.paperIds.slice(0, 6)
      : [],
    findingIds: Array.isArray(contradiction.findingIds)
      ? contradiction.findingIds.slice(0, 6)
      : [],
  }
}

/**
 * Deterministic JSON-context compaction by level (0..4).
 *
 * @param {object} context
 * @param {number} level
 * @returns {object}
 */
export function compactContextObject(context, level = 0) {
  if (!context || typeof context !== 'object') return context
  const ctx = JSON.parse(JSON.stringify(context))

  const abstractChars = level === 0 ? 180 : level === 1 ? 120 : level >= 3 ? 80 : 100
  const maxEvidence =
    level <= 1 ? 12 : level === 2 ? 8 : level === 3 ? 6 : 4
  const maxFindings = level <= 1 ? 8 : level === 2 ? 6 : 4
  const maxGaps = level <= 2 ? 5 : 3
  const maxContr = level <= 2 ? 5 : 3

  const compactList = (list, fn, max) =>
    Array.isArray(list) ? list.slice(0, max).map(fn) : list

  if (Array.isArray(ctx.evidenceItems)) {
    ctx.evidenceItems = compactList(
      [...ctx.evidenceItems].sort((a, b) => (b.relevance || 0) - (a.relevance || 0)),
      (item) =>
        compactEvidenceRecord(item, {
          abstractChars,
          dropExtras: level >= 1,
        }),
      maxEvidence,
    )
  }

  if (Array.isArray(ctx.findingsToEvaluate)) {
    ctx.findingsToEvaluate = compactList(
      ctx.findingsToEvaluate,
      (f) => compactFindingRecord(f, { statementChars: level >= 3 ? 180 : 280 }),
      maxFindings,
    )
  }
  if (Array.isArray(ctx.findings)) {
    ctx.findings = compactList(
      ctx.findings,
      (f) => compactFindingRecord(f, { statementChars: level >= 3 ? 180 : 280 }),
      maxFindings,
    )
  }
  if (Array.isArray(ctx.includableFindings)) {
    ctx.includableFindings = compactList(
      ctx.includableFindings,
      (f) => compactFindingRecord(f),
      maxFindings,
    )
  }

  if (Array.isArray(ctx.gaps)) {
    ctx.gaps = compactList(ctx.gaps, compactGapRecord, maxGaps)
  }
  if (Array.isArray(ctx.contradictions)) {
    ctx.contradictions = compactList(
      ctx.contradictions,
      compactContradictionRecord,
      maxContr,
    )
  }
  if (Array.isArray(ctx.retrievalGaps)) {
    ctx.retrievalGaps = compactList(ctx.retrievalGaps, compactGapRecord, maxGaps)
  }

  // Graph omitted for LLM from level 0 under minimum profile targets,
  // and always dropped by level >= 2.
  if (level >= 0 && (level >= 2 || !ctx.graph?.nodes?.length)) {
    if (ctx.graph) {
      ctx.graph = { nodes: [], edges: [], paths: [], omitted: true }
    }
  } else if (ctx.graph && level >= 1) {
    ctx.graph = {
      nodes: (ctx.graph.nodes || []).slice(0, 0),
      edges: (ctx.graph.edges || []).slice(0, 0),
      paths: (ctx.graph.paths || []).slice(0, 0),
      omitted: true,
    }
  }

  if (level >= 1) {
    if (Array.isArray(ctx.themes)) ctx.themes = ctx.themes.slice(0, 4)
    if (Array.isArray(ctx.relationships)) ctx.relationships = ctx.relationships.slice(0, 4)
    if (Array.isArray(ctx.keywords)) ctx.keywords = ctx.keywords.slice(0, 6)
  }

  if (level >= 3) {
    for (const key of Object.keys(ctx)) {
      if (typeof ctx[key] === 'string' && ctx[key].length > 400) {
        ctx[key] = truncate(ctx[key], 400)
      }
    }
  }

  return ctx
}

/**
 * Try to locate a JSON object/array in a prompt string and compact it.
 *
 * @param {string} content
 * @param {number} level
 * @returns {{ content: string, compacted: boolean }}
 */
export function compactPromptContent(content, level = 0) {
  const text = String(content || '')
  // Prefer last large JSON block (common TRACE user-prompt pattern)
  const startObj = text.lastIndexOf('\n{')
  const startArr = text.lastIndexOf('\n[')
  let start = -1
  if (startObj >= 0 && (startArr < 0 || startObj > startArr)) start = startObj + 1
  else if (startArr >= 0) start = startArr + 1
  else if (text.trimStart().startsWith('{')) start = text.indexOf('{')
  else if (text.trimStart().startsWith('[')) start = text.indexOf('[')

  if (start < 0) {
    // Non-JSON prompt: truncate tail only at high levels
    if (level >= 3 && text.length > 6000) {
      return { content: truncate(text, 6000), compacted: true }
    }
    return { content: text, compacted: false }
  }

  const jsonPart = text.slice(start)
  const prefix = text.slice(0, start)
  try {
    const parsed = JSON.parse(jsonPart)
    const compacted =
      Array.isArray(parsed)
        ? parsed.slice(0, 12)
        : compactContextObject(parsed, level)
    // Compact JSON (no pretty-print) — critical size win
    return {
      content: `${prefix}${JSON.stringify(compacted)}`,
      compacted: true,
    }
  } catch {
    if (level >= 2 && text.length > 8000) {
      return { content: truncate(text, 8000), compacted: true }
    }
    return { content: text, compacted: false }
  }
}

/**
 * @param {{ role?: string, content?: string }[]} messages
 * @param {number} level
 * @returns {{ messages: object[], compacted: boolean }}
 */
export function compactChatMessages(messages = [], level = 0) {
  let compacted = false
  const next = (messages || []).map((msg) => {
    if (msg?.role !== 'user') return { ...msg }
    const result = compactPromptContent(msg.content, level)
    if (result.compacted) compacted = true
    return { ...msg, content: result.content }
  })
  return { messages: next, compacted }
}

/**
 * Minimum viable completion budget per agent (structured JSON).
 *
 * @param {string} agent
 * @returns {number}
 */
export function getMinViableOutputTokens(agent) {
  const id = normalizeAgentId(agent)
  if (id === 'critic' || id === 'synthesizer') return 1024
  if (id === 'evidence_analyst') return 896
  return 384
}

/**
 * Fit request within provider TPM headroom by lowering output cap and compacting.
 *
 * @param {object} state
 * @returns {object}
 */
function fitRequestWithinProviderTpm(state) {
  const {
    agent,
    runId,
    messages,
    requestedOutputTokens,
    compactionCount,
    maxLevels,
  } = state
  let output = requestedOutputTokens
  let msgs = messages
  let comps = compactionCount
  const minOutput = getMinViableOutputTokens(agent)
  const tpm = getProviderTpmConfig()
  if (!tpm.enabled) {
    return {
      messages: msgs,
      requestedOutputTokens: output,
      compactionCount: comps,
      measure: measureChatRequest(msgs, { agent, runId, maxTokens: output }),
    }
  }

  let measure = measureChatRequest(msgs, { agent, runId, maxTokens: output })
  let headroom = getProviderTpmHeadroom()
  let remaining = headroom?.remainingTokens ?? null

  const fits = () =>
    remaining == null ||
    measure.estimatedInputTokens + output <= remaining

  while (!fits() && (output > minOutput || comps < maxLevels)) {
    if (output > minOutput) {
      output = Math.max(minOutput, output - 256)
    } else {
      const result = compactChatMessages(msgs, comps)
      msgs = result.messages
      comps += 1
    }
    measure = measureChatRequest(msgs, { agent, runId, maxTokens: output })
    headroom = getProviderTpmHeadroom()
    remaining = headroom?.remainingTokens ?? remaining
  }

  return {
    messages: msgs,
    requestedOutputTokens: output,
    compactionCount: comps,
    measure,
  }
}

/**
 * Wait for provider TPM window reset when headroom is below the next agent need.
 * Scheduling only — does not call the provider or change retry semantics.
 *
 * @param {string} agent
 * @param {{ runId?: string }} [options]
 * @returns {Promise<void>}
 */
export async function awaitProviderTpmHeadroom(agent, options = {}) {
  const tpm = getProviderTpmConfig()
  if (!tpm.enabled || getTraceProfile().name !== 'minimum') return

  const budget = getAgentTokenBudget(agent)
  const minNeed = Math.min(
    budget.maxInputTokens,
    512,
  ) + getMinViableOutputTokens(agent)

  const headroom = getProviderTpmHeadroom()
  if (!headroom?.remainingTokens || headroom.remainingTokens >= minNeed) {
    return
  }

  const resetMs = headroom.resetTokensMs
  if (!resetMs || resetMs <= 0 || resetMs > tpm.maxWaitMs) {
    return
  }

  const waitMs = Math.min(resetMs + 250, tpm.maxWaitMs)
  logContextBudget('tpm_headroom_wait', {
    agent: normalizeAgentId(agent),
    runId: options.runId || null,
    waitMs,
    providerTpmRemaining: headroom.remainingTokens,
    minNeed,
    resetTokensMs: resetMs,
    budgetAction: 'tpm_wait',
  })
  await new Promise((resolve) => setTimeout(resolve, waitMs))
}

/**
 * Worst-case per-agent and sequential TRACE token envelope (minimum profile).
 *
 * @returns {object}
 */
/**
 * Worst-case projected tokens for one refinement cycle (Explorer + Analyst + Critic).
 *
 * @returns {number}
 */
export function computeRefinementCycleProjectedTokens() {
  const agents = ['explorer', 'evidence_analyst', 'critic']
  let total = 0
  for (const agent of agents) {
    const budget = getAgentTokenBudget(agent)
    total += budget.maxInputTokens + budget.maxOutputTokens
  }
  return total
}

/**
 * Whether the TRACE can afford an optional refinement cycle without exceeding
 * the provider/local TPM envelope (reserves Synthesizer headroom).
 *
 * @param {{ totalTokens?: number }|null|undefined} accounting
 * @returns {{
 *   allowed: boolean,
 *   currentUsage: number,
 *   refinementProjected: number,
 *   synthesizerReserved: number,
 *   projectedTotal: number,
 *   limit: number|null,
 *   safetyMargin: number,
 *   reason: string|null
 * }}
 */
export function canAffordRefinementCycle(accounting) {
  const tpm = getProviderTpmConfig()
  const currentUsage = accounting?.totalTokens || 0
  const refinementProjected = computeRefinementCycleProjectedTokens()
  const synthesizerBudget = getAgentTokenBudget('synthesizer')
  const synthesizerReserved =
    synthesizerBudget.maxInputTokens + synthesizerBudget.maxOutputTokens
  const safetyMargin = tpm.safetyMargin || 128
  const limit = tpm.enabled ? tpm.limit - safetyMargin : null
  const projectedTotal =
    currentUsage + refinementProjected + synthesizerReserved

  return {
    allowed: limit == null || projectedTotal <= limit,
    currentUsage,
    refinementProjected,
    synthesizerReserved,
    projectedTotal,
    limit,
    safetyMargin,
    reason:
      limit != null && projectedTotal > limit
        ? `Refinement cycle would exceed TRACE token envelope (${projectedTotal} > ${limit})`
        : null,
  }
}

export function computeMinimumTraceTokenEnvelope() {
  const agents = [
    'planner',
    'explorer',
    'evidence_analyst',
    'critic',
    'synthesizer',
  ]
  const perAgent = {}
  let worstCaseSequentialProjected = 0
  for (const agent of agents) {
    const budget = getAgentTokenBudget(agent)
    const projected = budget.maxInputTokens + budget.maxOutputTokens
    perAgent[agent] = {
      maxInputTokens: budget.maxInputTokens,
      maxOutputTokens: budget.maxOutputTokens,
      projected,
    }
    worstCaseSequentialProjected += projected
  }
  const tpm = getProviderTpmConfig()
  return {
    perAgent,
    worstCaseSequentialProjected,
    providerTpmLimit: tpm.limit,
    withinSingleRequestTpmCap: Object.values(perAgent).every(
      (row) => row.projected <= tpm.limit,
    ),
    // Sequential TRACE uses separate TPM windows when headroom wait is applied.
    withinOneWindowWorstCase:
      worstCaseSequentialProjected <= tpm.limit + tpm.safetyMargin,
  }
}

/**
 * Enforce per-agent input budget before any provider call.
 * Returns a possibly compacted request. Throws AiContextBudgetError if still over.
 *
 * @param {import('../providers/llm.provider.js').LlmChatRequest} request
 * @param {{ agent?: string, runId?: string }} [options]
 * @returns {{ request: object, measure: object, compactionCount: number }}
 */
export function enforceContextBudget(request, options = {}) {
  const agent = normalizeAgentId(options.agent)
  const runId = options.runId || null
  const budget = getAgentTokenBudget(agent)
  let requestedOutputTokens =
    typeof request.maxTokens === 'number' && request.maxTokens > 0
      ? Math.min(request.maxTokens, budget.maxOutputTokens)
      : budget.maxOutputTokens

  let messages = Array.isArray(request.messages)
    ? request.messages.map((m) => ({ ...m }))
    : []
  let compactionCount = 0

  let measure = measureChatRequest(messages, {
    agent,
    runId,
    maxTokens: requestedOutputTokens,
  })

  logContextBudget('context_budget', {
    ...measure,
    budgetAction: measure.withinInputBudget ? 'allow' : 'compact',
    compactionLevel: 0,
  })

  const maxLevels = 5
  while (!measure.withinInputBudget && compactionCount < maxLevels) {
    const level = compactionCount
    const result = compactChatMessages(messages, level)
    messages = result.messages
    compactionCount += 1
    measure = measureChatRequest(messages, {
      agent,
      runId,
      maxTokens: requestedOutputTokens,
    })
    logContextBudget('context_budget', {
      ...measure,
      budgetAction: measure.withinInputBudget ? 'allow_after_compact' : 'compact',
      compactionLevel: level,
    })
  }

  if (!measure.withinInputBudget) {
    logContextBudget('context_budget', {
      ...measure,
      budgetAction: 'fail_local',
      compactionLevel: compactionCount,
    })
    recordContextBudgetEvent({
      agent,
      estimatedContextTokens: measure.estimatedInputTokens,
      maxContextTokens: measure.maxInputTokens,
      budgetCompactions: compactionCount,
      failed: true,
    })
    throw new AiContextBudgetError(
      `AI context budget exceeded for ${agent} (${measure.estimatedInputTokens}/${measure.maxInputTokens} est. input tokens)`,
      {
        agent,
        runId,
        serializedChars: measure.serializedChars,
        estimatedInputTokens: measure.estimatedInputTokens,
        maxInputTokens: measure.maxInputTokens,
        requestedOutputTokens: measure.requestedOutputTokens,
        projectedTotalTokens: measure.projectedTotalTokens,
        providerTpmRemaining: measure.providerTpmRemaining,
        compactionCount,
      },
    )
  }

  const tpmFit = fitRequestWithinProviderTpm({
    agent,
    runId,
    messages,
    requestedOutputTokens,
    compactionCount,
    maxLevels,
  })
  messages = tpmFit.messages
  requestedOutputTokens = tpmFit.requestedOutputTokens
  compactionCount = tpmFit.compactionCount
  measure = tpmFit.measure

  if (!measure.tpmWithinBudget) {
    logContextBudget('context_budget', {
      ...measure,
      budgetAction: 'fail_local_tpm',
      compactionLevel: compactionCount,
    })
    recordContextBudgetEvent({
      agent,
      estimatedContextTokens: measure.estimatedInputTokens,
      maxContextTokens: measure.maxInputTokens,
      budgetCompactions: compactionCount,
      failed: true,
    })
    throw new AiContextBudgetError(
      `AI provider TPM headroom exceeded for ${agent} (projected ${measure.projectedTotalTokens}/${measure.providerTpmRemaining} est. TPM remaining)`,
      {
        agent,
        runId,
        serializedChars: measure.serializedChars,
        estimatedInputTokens: measure.estimatedInputTokens,
        maxInputTokens: measure.maxInputTokens,
        requestedOutputTokens: measure.requestedOutputTokens,
        projectedTotalTokens: measure.projectedTotalTokens,
        providerTpmRemaining: measure.providerTpmRemaining,
        compactionCount,
      },
    )
  }

  recordContextBudgetEvent({
    agent,
    estimatedContextTokens: measure.estimatedInputTokens,
    maxContextTokens: measure.maxInputTokens,
    budgetCompactions: compactionCount,
    failed: false,
  })

  return {
    request: {
      ...request,
      messages,
      maxTokens: requestedOutputTokens,
    },
    measure,
    compactionCount,
  }
}

/**
 * True when error is a local context-budget failure (never a provider 413).
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isContextBudgetError(error) {
  if (!error || typeof error !== 'object') return false
  return (
    error instanceof AiContextBudgetError ||
    error.code === 'AI_CONTEXT_BUDGET_EXCEEDED' ||
    error.name === 'AiContextBudgetError'
  )
}

export default {
  PROVENANCE_KEYS,
  INPUT_TOKEN_ESTIMATE_SAFETY_MULTIPLIER,
  estimateTokensFromChars,
  measureSerializedChars,
  measureChatRequest,
  logContextBudget,
  compactEvidenceRecord,
  compactFindingRecord,
  compactGapRecord,
  compactContradictionRecord,
  compactContextObject,
  compactPromptContent,
  compactChatMessages,
  enforceContextBudget,
  isContextBudgetError,
  getMinViableOutputTokens,
  awaitProviderTpmHeadroom,
  computeMinimumTraceTokenEnvelope,
  computeRefinementCycleProjectedTokens,
  canAffordRefinementCycle,
}
