/**
 * @fileoverview Centralized TRACE profile + per-agent LLM input budgets.
 * TRACE_PROFILE=minimum is the controlled end-to-end baseline.
 */
import { AppError } from '../../utils/AppError.js'

/** Mistral verified TPM 50k — local envelope leaves 5k headroom below provider cap. */
export const MISTRAL_MINIMUM_TPM_LIMIT = 45_000

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
export function envNumber(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** @type {Readonly<object>} */
export const MINIMUM_PROFILE = Object.freeze({
  name: 'minimum',
  papers: 8,
  // Critic must evaluate every Analyst finding handed to Synthesizer.
  // 8 covers observed Analyst outputs (e.g. 7) within critic context budget.
  findings: 8,
  gaps: 5,
  contradictions: 5,
  evidenceItems: 12,
  graphNodes: 0,
  graphEdges: 0,
  graphPaths: 0,
  abstractChars: 100,
  searchQueries: 5,
  resultsPerQuery: 8,
  graphRagCalls: 2,
  refinedQueries: 1,
  // Groq on_demand TPM observed at 8,000 — TRACE must fit one rolling window.
  providerTpmLimit: 8000,
  providerTpmSafetyMargin: 128,
  providerTpmMaxWaitMs: 65_000,
  agentMaxInputTokens: Object.freeze({
    planner: 4000,
    explorer: 6000,
    evidence_analyst: 5500,
    critic: 4500,
    synthesizer: 5500,
    default: 6000,
  }),
  agentMaxOutputTokens: Object.freeze({
    planner: 1280,
    explorer: 384,
    evidence_analyst: 2100,
    critic: 2800,
    synthesizer: 2048,
    default: 1536,
  }),
  qualityGate: Object.freeze({
    citationValidityMin: 0.95,
    evidenceIdValidityMin: 1.0,
    paperIdValidityMin: 1.0,
    supportedFindingRateMin: 0.8,
    graphOrphanRateMax: 0.05,
    duplicateGraphIdsMax: 0,
    reportCompletenessMin: 0.9,
    providerFailuresMax: 0,
    payloadTooLargeMax: 0,
  }),
})

/** @type {Readonly<object>} */
export const STANDARD_PROFILE = Object.freeze({
  name: 'standard',
  papers: 15,
  findings: 10,
  gaps: 8,
  contradictions: 8,
  evidenceItems: 15,
  graphNodes: 10,
  graphEdges: 10,
  graphPaths: 5,
  abstractChars: 220,
  searchQueries: 7,
  resultsPerQuery: 10,
  graphRagCalls: 4,
  refinedQueries: 2,
  agentMaxInputTokens: Object.freeze({
    planner: 4000,
    explorer: 6000,
    evidence_analyst: 7000,
    critic: 6000,
    synthesizer: 7000,
    default: 6000,
  }),
  agentMaxOutputTokens: Object.freeze({
    planner: 2048,
    explorer: 1024,
    evidence_analyst: 2500,
    critic: 3000,
    synthesizer: 3500,
    default: 2048,
  }),
  qualityGate: Object.freeze({ ...MINIMUM_PROFILE.qualityGate }),
})

/**
 * Active TRACE profile (env TRACE_PROFILE, default minimum).
 *
 * @returns {object}
 */
export function getTraceProfile() {
  const name = String(process.env.TRACE_PROFILE || 'minimum')
    .trim()
    .toLowerCase()
  if (name === 'standard' || name === 'default') return STANDARD_PROFILE
  return MINIMUM_PROFILE
}

/**
 * Resolve agent id aliases used across services.
 *
 * @param {string} [agent]
 * @returns {string}
 */
export function normalizeAgentId(agent) {
  const id = String(agent || 'default').toLowerCase()
  if (id === 'evidenceanalyst' || id === 'analyst') return 'evidence_analyst'
  if (id === 'explorer_advisory') return 'explorer'
  return id
}

/**
 * @param {string} [agent]
 * @returns {{ maxInputTokens: number, maxOutputTokens: number }}
 */
export function getAgentTokenBudget(agent) {
  const profile = getTraceProfile()
  const id = normalizeAgentId(agent)
  return {
    maxInputTokens: envNumber(
      `TRACE_MAX_INPUT_TOKENS_${id.toUpperCase()}`,
      profile.agentMaxInputTokens[id] ?? profile.agentMaxInputTokens.default,
    ),
    maxOutputTokens: envNumber(
      `TRACE_MAX_OUTPUT_TOKENS_${id.toUpperCase()}`,
      profile.agentMaxOutputTokens[id] ?? profile.agentMaxOutputTokens.default,
    ),
  }
}

/**
 * Artifact caps from the active profile (env can override each).
 *
 * @returns {object}
 */
export function getProfileArtifactLimits() {
  const p = getTraceProfile()
  return {
    profile: p.name,
    maxPapers: envNumber('TRACE_MAX_PAPERS', p.papers),
    maxFindings: envNumber('TRACE_MAX_FINDINGS', p.findings),
    maxGaps: envNumber('TRACE_MAX_GAPS', p.gaps),
    maxContradictions: envNumber('TRACE_MAX_CONTRADICTIONS', p.contradictions),
    maxEvidenceItems: envNumber('TRACE_MAX_EVIDENCE_ITEMS', p.evidenceItems),
    maxGraphNodes: envNumber('TRACE_MAX_GRAPH_NODES', p.graphNodes),
    maxGraphEdges: envNumber('TRACE_MAX_GRAPH_EDGES', p.graphEdges),
    maxGraphPaths: envNumber('TRACE_MAX_GRAPH_PATHS', p.graphPaths),
    maxAbstractChars: envNumber('TRACE_MAX_ABSTRACT_CHARS', p.abstractChars),
    maxSearchQueries: envNumber('TRACE_MAX_SEARCH_QUERIES', p.searchQueries),
    maxResultsPerQuery: envNumber(
      'TRACE_MAX_RESULTS_PER_QUERY',
      p.resultsPerQuery,
    ),
    maxGraphRagCalls: envNumber('TRACE_MAX_GRAPHRAG_CALLS', p.graphRagCalls),
    maxRefinedQueries: envNumber('TRACE_MAX_REFINED_QUERIES', p.refinedQueries),
  }
}

/**
 * Quality-gate thresholds from profile + optional env overrides.
 *
 * @returns {object}
 */
/**
 * Resolve AI provider host from runtime env (not import-time snapshot).
 *
 * @returns {string}
 */
export function getAiProviderBaseUrlHost() {
  const raw = String(process.env.AI_BASE_URL || '').trim()
  if (!raw) return ''
  try {
    return new URL(raw).host.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Provider-specific TPM defaults for minimum profile.
 * Groq keeps the 8k envelope; Mistral uses 45k (50k provider cap − 5k margin).
 *
 * @param {object} [profile]
 * @returns {{
 *   limit: number,
 *   safetyMargin: number,
 *   maxWaitMs: number,
 *   providerKind: 'mistral'|'groq'|'default'
 * }}
 */
export function resolveProviderTpmDefaults(profile = getTraceProfile()) {
  const host = getAiProviderBaseUrlHost()
  const base = {
    safetyMargin: profile.providerTpmSafetyMargin ?? 128,
    maxWaitMs: profile.providerTpmMaxWaitMs ?? 65_000,
  }

  if (host.includes('mistral.ai')) {
    return {
      ...base,
      limit: MISTRAL_MINIMUM_TPM_LIMIT,
      providerKind: 'mistral',
    }
  }

  if (host.includes('groq.com')) {
    return {
      ...base,
      limit: profile.providerTpmLimit ?? 8000,
      providerKind: 'groq',
    }
  }

  return {
    ...base,
    limit: profile.providerTpmLimit ?? 0,
    providerKind: 'default',
  }
}

/**
 * Provider TPM guardrails (env TRACE_PROVIDER_TPM_LIMIT overrides provider default).
 *
 * @returns {{
 *   enabled: boolean,
 *   limit: number,
 *   safetyMargin: number,
 *   maxWaitMs: number,
 *   providerKind: 'mistral'|'groq'|'default'
 * }}
 */
export function getProviderTpmConfig() {
  const profile = getTraceProfile()
  const defaults = resolveProviderTpmDefaults(profile)
  const limit = envNumber('TRACE_PROVIDER_TPM_LIMIT', defaults.limit)
  const safetyMargin = envNumber(
    'TRACE_PROVIDER_TPM_SAFETY',
    defaults.safetyMargin,
  )
  const maxWaitMs = envNumber(
    'TRACE_PROVIDER_TPM_MAX_WAIT_MS',
    defaults.maxWaitMs,
  )
  return {
    enabled: limit > 0,
    limit,
    safetyMargin,
    maxWaitMs,
    providerKind: defaults.providerKind,
  }
}

export function getQualityGateThresholds() {
  const g = getTraceProfile().qualityGate
  return {
    citationValidityMin: envNumber(
      'TRACE_QG_CITATION_VALIDITY_MIN',
      g.citationValidityMin,
    ),
    evidenceIdValidityMin: envNumber(
      'TRACE_QG_EVIDENCE_ID_VALIDITY_MIN',
      g.evidenceIdValidityMin,
    ),
    paperIdValidityMin: envNumber(
      'TRACE_QG_PAPER_ID_VALIDITY_MIN',
      g.paperIdValidityMin,
    ),
    supportedFindingRateMin: envNumber(
      'TRACE_QG_SUPPORTED_FINDING_RATE_MIN',
      g.supportedFindingRateMin,
    ),
    graphOrphanRateMax: envNumber(
      'TRACE_QG_GRAPH_ORPHAN_RATE_MAX',
      g.graphOrphanRateMax,
    ),
    duplicateGraphIdsMax: envNumber(
      'TRACE_QG_DUPLICATE_GRAPH_IDS_MAX',
      g.duplicateGraphIdsMax,
    ),
    reportCompletenessMin: envNumber(
      'TRACE_QG_REPORT_COMPLETENESS_MIN',
      g.reportCompletenessMin,
    ),
    providerFailuresMax: envNumber(
      'TRACE_QG_PROVIDER_FAILURES_MAX',
      g.providerFailuresMax,
    ),
    payloadTooLargeMax: envNumber(
      'TRACE_QG_PAYLOAD_TOO_LARGE_MAX',
      g.payloadTooLargeMax,
    ),
  }
}

export class AiContextBudgetError extends AppError {
  /**
   * @param {string} [message]
   * @param {object} [meta]
   */
  constructor(message = 'AI context budget exceeded', meta = {}) {
    super(message, 413)
    this.name = 'AiContextBudgetError'
    this.code = 'AI_CONTEXT_BUDGET_EXCEEDED'
    this.budget = meta
  }
}

export default {
  MINIMUM_PROFILE,
  STANDARD_PROFILE,
  getTraceProfile,
  getAgentTokenBudget,
  getProfileArtifactLimits,
  getQualityGateThresholds,
  getProviderTpmConfig,
  resolveProviderTpmDefaults,
  getAiProviderBaseUrlHost,
  MISTRAL_MINIMUM_TPM_LIMIT,
  normalizeAgentId,
  envNumber,
  AiContextBudgetError,
}
