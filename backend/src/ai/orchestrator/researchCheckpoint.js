/**
 * @fileoverview Deterministic TRACE stage checkpoints for resumability.
 * If Planner/Explorer/Analyst completed, Critic failure must not re-run them.
 */

export const CHECKPOINT_ACTIVITY = 'AI_RESEARCH_CHECKPOINT'

/**
 * @param {string} query
 * @returns {string}
 */
export function normalizeQueryKey(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} activityQuery
 * @param {string} queryKey
 * @returns {boolean}
 */
function queryMatches(activityQuery, queryKey) {
  if (!queryKey) return true
  if (!activityQuery) return true
  if (activityQuery === queryKey) return true
  // queryPreview may be truncated
  if (queryKey.startsWith(activityQuery) || activityQuery.startsWith(queryKey)) {
    return true
  }
  return false
}

/**
 * Pure resume selection from session activities (any order).
 *
 * @param {object[]} activities
 * @param {string} query
 * @returns {{
 *   resumable: boolean,
 *   resumeFrom: string|null,
 *   plan: object|null,
 *   evidencePackage: object|null,
 *   analyticalFindings: object|null,
 *   critiqueResult: object|null,
 *   workflow: object|null,
 *   sourceRunId: string|null,
 * }}
 */
export function selectResumeState(activities = [], query = '') {
  const queryKey = normalizeQueryKey(query)
  const sorted = [...(activities || [])].sort((a, b) => {
    const ta = new Date(a.createdAt || a.timestamp || 0).getTime()
    const tb = new Date(b.createdAt || b.timestamp || 0).getTime()
    return tb - ta
  })

  // Only consider history after the latest successful completion
  let windowEnd = sorted.length
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].type === 'AI_RESEARCH_COMPLETED') {
      windowEnd = i
      break
    }
  }
  const window = sorted.slice(0, windowEnd)

  /** @type {object} */
  const artifacts = {
    plan: null,
    evidencePackage: null,
    analyticalFindings: null,
    critiqueResult: null,
    workflow: null,
    sourceRunId: null,
  }

  let sawFailed = false

  for (const activity of window) {
    const metaQuery = normalizeQueryKey(
      activity.metadata?.query ||
        activity.payload?.query ||
        activity.metadata?.queryPreview ||
        '',
    )
    if (!queryMatches(metaQuery, queryKey)) continue

    if (activity.type === 'AI_RESEARCH_FAILED') {
      sawFailed = true
      continue
    }

    if (activity.type !== CHECKPOINT_ACTIVITY) continue

    const stage = activity.metadata?.stage || activity.payload?.stage
    const payload = activity.payload || {}
    artifacts.sourceRunId =
      activity.metadata?.runId || artifacts.sourceRunId || null
    if (payload.workflow) artifacts.workflow = artifacts.workflow || payload.workflow

    if (stage === 'PLANNING' && payload.plan && !artifacts.plan) {
      artifacts.plan = payload.plan
    }
    if (stage === 'EXPLORING' && payload.evidencePackage && !artifacts.evidencePackage) {
      artifacts.evidencePackage = payload.evidencePackage
      artifacts.plan = artifacts.plan || payload.plan || null
    }
    if (
      stage === 'ANALYZING' &&
      payload.analyticalFindings &&
      !artifacts.analyticalFindings
    ) {
      artifacts.analyticalFindings = payload.analyticalFindings
      artifacts.plan = artifacts.plan || payload.plan || null
      artifacts.evidencePackage =
        artifacts.evidencePackage || payload.evidencePackage || null
    }
    if (stage === 'CRITIQUING' && payload.critiqueResult && !artifacts.critiqueResult) {
      artifacts.critiqueResult = payload.critiqueResult
      artifacts.plan = artifacts.plan || payload.plan || null
      artifacts.evidencePackage =
        artifacts.evidencePackage || payload.evidencePackage || null
      artifacts.analyticalFindings =
        artifacts.analyticalFindings || payload.analyticalFindings || null
    }
  }

  let resumeFrom = null
  if (
    artifacts.critiqueResult &&
    artifacts.analyticalFindings &&
    artifacts.evidencePackage &&
    artifacts.plan
  ) {
    resumeFrom = 'SYNTHESIZING'
  } else if (
    artifacts.analyticalFindings &&
    artifacts.evidencePackage &&
    artifacts.plan
  ) {
    resumeFrom = 'CRITIQUING'
  } else if (artifacts.evidencePackage && artifacts.plan) {
    resumeFrom = 'ANALYZING'
  } else if (artifacts.plan) {
    resumeFrom = 'EXPLORING'
  }

  const resumable = Boolean(resumeFrom) && sawFailed

  return {
    resumable,
    resumeFrom: resumable ? resumeFrom : null,
    plan: resumable ? artifacts.plan : null,
    evidencePackage: resumable ? artifacts.evidencePackage : null,
    analyticalFindings: resumable ? artifacts.analyticalFindings : null,
    critiqueResult: resumable ? artifacts.critiqueResult : null,
    workflow: resumable ? artifacts.workflow : null,
    sourceRunId: resumable ? artifacts.sourceRunId : null,
  }
}

/**
 * Build checkpoint activity fields (caller persists).
 *
 * @param {object} args
 * @returns {object}
 */
export function buildCheckpointActivity({
  sessionId,
  runId,
  query,
  stage,
  workflow,
  plan = null,
  evidencePackage = null,
  analyticalFindings = null,
  critiqueResult = null,
}) {
  return {
    sessionId,
    type: CHECKPOINT_ACTIVITY,
    description: `Research checkpoint: ${stage}`,
    message: `Research checkpoint: ${stage}`,
    agentId: 'orchestrator',
    metadata: {
      runId,
      agent: 'orchestrator',
      sessionId,
      stage,
      query: String(query || '').slice(0, 500),
      queryPreview: String(query || '').slice(0, 160),
    },
    payload: {
      stage,
      query: String(query || '').slice(0, 500),
      workflow,
      ...(plan ? { plan } : {}),
      ...(evidencePackage ? { evidencePackage } : {}),
      ...(analyticalFindings ? { analyticalFindings } : {}),
      ...(critiqueResult ? { critiqueResult } : {}),
    },
    severity: 'info',
  }
}

export default {
  CHECKPOINT_ACTIVITY,
  normalizeQueryKey,
  selectResumeState,
  buildCheckpointActivity,
}
