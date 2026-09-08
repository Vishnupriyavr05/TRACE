/**
 * @fileoverview Critic service — AnalyticalFindings + EvidencePackage → CritiqueResult.
 * Owns FINAL confidence. Does not rewrite findings. Does not generate Research Report.
 */
import mongoose from 'mongoose'
import { requireOwnedSession } from '../../services/researchSession.service.js'
import * as activityService from '../../services/researchActivity.service.js'
import * as explainabilityService from '../../services/explainability.service.js'
import { AppError } from '../../utils/AppError.js'
import { runAgent } from '../core/agentRunner.js'
import { createRunId } from '../core/runId.js'
import { getSafeAiMeta } from '../providers/index.js'
import { createCriticAgent } from './critic.agent.js'
import { buildCriticContext } from './critic.context.js'
import {
  validateCriticInput,
  buildEmptyCritique,
} from '../validators/critic.schema.js'
import { enforceEvidenceLevelsOnCritique } from '../core/evidenceLevelEnforcement.js'
import { buildPackageEvidenceIndexes } from '../core/evidencePackageIndexes.js'

export const CRITIC_ACTIVITY = Object.freeze({
  STARTED: 'AI_CRITIC_STARTED',
  COMPLETED: 'AI_CRITIC_COMPLETED',
  FAILED: 'AI_CRITIC_FAILED',
})

const MAX_VALIDATION_ERRORS_IN_META = 20
const MAX_VALIDATION_MESSAGE_CHARS = 200

/**
 * Compact, safe diagnostics for Critic failure activities.
 * Never includes prompts, LLM text, keys, or auth headers.
 *
 * @param {unknown} error
 * @param {{
 *   runId: string,
 *   sessionId: string,
 *   provider?: string,
 *   model?: string,
 *   durationMs?: number,
 * }} base
 * @returns {object}
 */
export function buildCriticFailureActivityMetadata(error, base) {
  const code = error?.code || error?.name || 'AI_ERROR'
  const rawErrors = Array.isArray(error?.errors)
    ? error.errors.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  const validationErrors = rawErrors
    .slice(0, MAX_VALIDATION_ERRORS_IN_META)
    .map((message) => {
      const truncated = message.slice(0, MAX_VALIDATION_MESSAGE_CHARS)
      // Common validator shape: "findingEvaluations[0].findingId is required"
      const pathMatch = truncated.match(/^([A-Za-z_][\w.\[\]]*)\b/)
      return {
        path: pathMatch ? pathMatch[1] : null,
        message: truncated,
      }
    })

  return {
    runId: base.runId,
    agent: 'critic',
    sessionId: base.sessionId,
    success: false,
    code,
    provider: base.provider,
    model: base.model,
    durationMs: base.durationMs,
    validationErrorCount: rawErrors.length,
    validationErrorPaths: validationErrors
      .map((item) => item.path)
      .filter(Boolean),
    validationErrorMessages: validationErrors.map((item) => item.message),
  }
}

/**
 * Map CritiqueResult into structured explainability fields (no CoT).
 *
 * @param {object} critique
 * @param {object} analyticalFindings
 * @param {{ runId: string, contextBounded: boolean }} meta
 * @returns {object}
 */
function buildExplainabilityPayload(critique, analyticalFindings, meta) {
  const findingById = new Map(
    (analyticalFindings?.findings || []).map((f) => [String(f.id), f])
  )

  const evidenceLinks = (critique.findingEvaluations || []).map((evaluation) => {
    const original = findingById.get(evaluation.findingId)
    return {
      findingId: evaluation.findingId,
      originalStatement: original?.statement || null,
      analystType: original?.type || null,
      analystPreliminaryConfidence: original?.confidence || null,
      support: evaluation.support,
      confidence: evaluation.confidence,
      recommendedHandling: evaluation.recommendedHandling,
      evidenceIds: evaluation.evidenceIds || [],
      paperIds: evaluation.paperIds || [],
      evidenceAssessment: evaluation.evidenceAssessment || '',
      issues: evaluation.issues || [],
      source: 'critic',
    }
  })

  const confidenceScores = {
    preliminary: Object.fromEntries(
      (analyticalFindings?.findings || []).map((f) => [f.id, f.confidence])
    ),
    final: Object.fromEntries(
      (critique.findingEvaluations || []).map((e) => [e.findingId, e.confidence])
    ),
    overall: critique.overallAssessment?.confidence || 'LOW',
    evidenceSufficiency:
      critique.overallAssessment?.evidenceSufficiency || 'INSUFFICIENT',
    note: critique.confidenceNote,
  }

  const contradictions = (critique.contradictions || []).map((c) => ({
    id: c.id,
    description: c.description,
    findingIds: c.findingIds || [],
    paperIds: c.paperIds || [],
    evidenceIds: c.evidenceIds || [],
    severity: c.severity,
    source: 'critic',
  }))

  const researchGaps = (critique.gaps || []).map((gap) => ({
    id: gap.id,
    description: gap.description,
    evidenceIds: gap.evidenceIds || [],
    severity: gap.severity,
    source: 'critic',
  }))

  const citationSupport = (critique.findingEvaluations || []).map((e) => ({
    findingId: e.findingId,
    support: e.support,
    recommendedHandling: e.recommendedHandling,
    paperIds: e.paperIds || [],
    evidenceIds: e.evidenceIds || [],
  }))

  return {
    evidenceLinks,
    confidenceScores,
    contradictions,
    researchGaps,
    citationSupport,
    status: 'draft',
    metadata: {
      agent: 'critic',
      runId: meta.runId,
      stage: 'critique_result',
      confidenceScope: 'final_for_claim_validation',
      contextBounded: meta.contextBounded,
      evidenceCoverage: critique.evidenceCoverage || [],
      overallAssessment: critique.overallAssessment || {},
      updatedBy: 'critic',
    },
  }
}

/**
 * Post-process evaluations: backfill paperIds from evidenceId map.
 *
 * @param {object} critique
 * @param {Map<string, string>} evidenceIdToPaperId
 * @param {Set<string>} allowedPaperIds
 * @returns {object}
 */
function enrichCritiqueProvenance(critique, evidenceIdToPaperId, allowedPaperIds) {
  const findingEvaluations = (critique.findingEvaluations || []).map((e) => {
    const papers = new Set(e.paperIds || [])
    for (const eid of e.evidenceIds || []) {
      const pid = evidenceIdToPaperId.get(eid)
      if (pid && allowedPaperIds.has(pid)) papers.add(pid)
    }
    return { ...e, paperIds: [...papers] }
  })
  return { ...critique, findingEvaluations }
}

/**
 * Critique AnalyticalFindings against an EvidencePackage.
 *
 * @param {string} userId
 * @param {{
 *   sessionId: string,
 *   query: string,
 *   evidencePackage: object,
 *   analyticalFindings: object
 * }} input
 * @returns {Promise<{
 *   runId: string,
 *   agent: string,
 *   critique: object,
 *   meta: object
 * }>}
 */
export async function critiqueAnalyticalFindings(userId, input) {
  const validated = validateCriticInput(input)
  if (!validated.ok) {
    throw new AppError(
      'Invalid critic request',
      400,
      validated.errors || ['Validation failed']
    )
  }

  const { sessionId, query, evidencePackage, analyticalFindings } =
    validated.value

  await requireOwnedSession(userId, sessionId)

  const runId = createRunId()
  const safeMeta = getSafeAiMeta()
  const startedAt = Date.now()
  const researchQuestion =
    analyticalFindings.researchQuestion ||
    evidencePackage.researchQuestion ||
    query
  /** @type {object|null} */
  let payloadDiagnostics = null

  await activityService.createActivity(userId, {
    sessionId,
    type: CRITIC_ACTIVITY.STARTED,
    description: 'Critic agent started',
    message: 'Critic agent started',
    agentId: 'critic',
    metadata: {
      runId,
      agent: 'critic',
      sessionId,
      findingsCount: analyticalFindings.findings?.length || 0,
      paperCount: evidencePackage.papers?.length || 0,
      provider: safeMeta.provider,
      model: safeMeta.model,
      queryPreview: query.slice(0, 160),
    },
    severity: 'info',
  })

  try {
    const findingCount = analyticalFindings.findings?.length || 0
    const paperCount = evidencePackage.papers?.length || 0

    /** @type {object} */
    let critique
    /** @type {object} */
    let meta = {
      startedAt: new Date(startedAt).toISOString(),
      endedAt: null,
      durationMs: 0,
      success: true,
      model: safeMeta.model,
      provider: safeMeta.provider,
      usage: null,
      contextBounded: false,
      emptyCritique: false,
    }

    if (findingCount === 0 || paperCount === 0) {
      critique = buildEmptyCritique({
        runId,
        sessionId,
        researchQuestion,
        analyticalFindings,
        evidencePackage,
      })
      meta.emptyCritique = true
      meta.endedAt = new Date().toISOString()
      meta.durationMs = Date.now() - startedAt
    } else {
      const built = buildCriticContext(
        evidencePackage,
        analyticalFindings,
        researchQuestion
      )

      // Safe payload-size observability (no prompts / secrets)
      payloadDiagnostics = {
        findings: built.payload?.findings,
        papers: built.payload?.papers,
        evidenceItems: built.payload?.evidenceItems,
        graphNodes: built.payload?.graphNodes,
        graphEdges: built.payload?.graphEdges,
        graphPaths: built.payload?.graphPaths,
        serializedChars: built.payload?.serializedChars,
        estimatedTokens: built.payload?.estimatedTokens,
        findingsAvailable: built.stats?.findingsAvailable,
        papersAvailable: built.stats?.papersAvailable,
        bounded: built.bounded,
      }
      console.info('[AI] critic.context_payload', {
        ...safeMeta,
        agent: 'critic',
        runId,
        ...payloadDiagnostics,
      })

      const agent = createCriticAgent({
        runId,
        sessionId,
        researchQuestion,
        findingIds: built.findingIds,
        allowedPaperIds: built.allowedPaperIds,
        allowedEvidenceIds: built.allowedEvidenceIds,
        evidenceIdToPaperId: built.evidenceIdToPaperId,
      })

      const result = await runAgent(
        agent,
        { context: built.context },
        { runId }
      )

      critique = enrichCritiqueProvenance(
        {
          ...result.output,
          runId,
          sessionId,
          researchQuestion,
          contextStats: built.stats,
        },
        built.evidenceIdToPaperId,
        built.allowedPaperIds
      )

      meta = {
        ...result.meta,
        contextBounded: built.bounded,
        contextStats: built.stats,
        payloadDiagnostics,
        emptyCritique: false,
      }
    }

    const indexed = buildPackageEvidenceIndexes(evidencePackage)
    critique = enforceEvidenceLevelsOnCritique(
      critique,
      analyticalFindings.findings || [],
      indexed.evidenceItems,
      indexed.evidenceIdToPaperId,
    )

    try {
      await explainabilityService.upsertForSession(userId, sessionId, {
        ...buildExplainabilityPayload(critique, analyticalFindings, {
          runId,
          contextBounded: Boolean(meta.contextBounded),
        }),
      })
    } catch (explainError) {
      meta.explainabilityUpsertError =
        explainError?.message || 'Explainability upsert failed'
    }

    const supportCounts = countSupport(critique.findingEvaluations || [])

    await activityService.createActivity(userId, {
      sessionId,
      type: CRITIC_ACTIVITY.COMPLETED,
      description: 'Critic agent completed',
      message: 'Critic agent completed',
      agentId: 'critic',
      metadata: {
        runId,
        agent: 'critic',
        sessionId,
        success: true,
        findingsEvaluated: critique.findingEvaluations?.length || 0,
        contradictionsFound: critique.contradictions?.length || 0,
        gapsFound: critique.gaps?.length || 0,
        coverageItems: critique.evidenceCoverage?.length || 0,
        overallConfidence: critique.overallAssessment?.confidence || 'LOW',
        evidenceSufficiency:
          critique.overallAssessment?.evidenceSufficiency || 'INSUFFICIENT',
        supportCounts,
        durationMs: meta.durationMs,
        provider: meta.provider,
        model: meta.model,
        contextBounded: Boolean(meta.contextBounded),
        emptyCritique: Boolean(meta.emptyCritique),
        ...(payloadDiagnostics ? { payloadDiagnostics } : {}),
      },
      payload: {
        critiqueSummary: {
          findingIds: (critique.findingEvaluations || []).map((e) => e.findingId),
          overallAssessment: critique.overallAssessment,
          contradictionIds: (critique.contradictions || []).map((c) => c.id),
          gapIds: (critique.gaps || []).map((g) => g.id),
        },
      },
      severity: 'info',
    })

    return {
      runId,
      agent: 'critic',
      critique,
      meta,
    }
  } catch (error) {
    try {
      await activityService.createActivity(userId, {
        sessionId,
        type: CRITIC_ACTIVITY.FAILED,
        // Stage failure only — terminal rate-limit text is emitted once by orchestrator
        description: 'Critic agent failed',
        message: 'Critic agent failed',
        agentId: 'critic',
        metadata: {
          ...buildCriticFailureActivityMetadata(error, {
            runId,
            sessionId,
            provider: safeMeta.provider,
            model: safeMeta.model,
            durationMs: Date.now() - startedAt,
          }),
          ...(payloadDiagnostics ? { payloadDiagnostics } : {}),
        },
        severity: 'error',
      })
    } catch {
      // ignore activity write failures on error path
    }
    throw error
  }
}

/**
 * @param {object[]} evaluations
 * @returns {object}
 */
function countSupport(evaluations) {
  const counts = {
    SUPPORTED: 0,
    PARTIALLY_SUPPORTED: 0,
    UNSUPPORTED: 0,
    INSUFFICIENT_EVIDENCE: 0,
  }
  for (const evaluation of evaluations) {
    if (counts[evaluation.support] !== undefined) {
      counts[evaluation.support] += 1
    }
  }
  return counts
}

/**
 * @param {string} userId
 * @param {object} body
 */
export async function critiqueFromRequest(userId, body) {
  if (!mongoose.Types.ObjectId.isValid(String(body?.sessionId || ''))) {
    throw new AppError('Invalid session id', 400)
  }
  return critiqueAnalyticalFindings(userId, body)
}

export default {
  critiqueAnalyticalFindings,
  critiqueFromRequest,
  buildCriticFailureActivityMetadata,
  CRITIC_ACTIVITY,
}
