/**
 * @fileoverview Evidence Analyst service — EvidencePackage → AnalyticalFindings.
 * Does not call Discovery/GraphRAG. Does not generate a Research Report.
 */
import mongoose from 'mongoose'
import { requireOwnedSession } from '../../services/researchSession.service.js'
import * as activityService from '../../services/researchActivity.service.js'
import * as explainabilityService from '../../services/explainability.service.js'
import { AppError } from '../../utils/AppError.js'
import { runAgent } from '../core/agentRunner.js'
import { createRunId } from '../core/runId.js'
import { getSafeAiMeta } from '../providers/index.js'
import { createEvidenceAnalystAgent } from './evidenceAnalyst.agent.js'
import { buildAnalystContext } from './evidenceAnalyst.context.js'
import {
  validateEvidenceAnalystInput,
  buildInsufficientEvidenceAnalysis,
} from '../validators/evidenceAnalyst.schema.js'
import { boundAnalyticalFindingsForHandoff } from '../core/findingsHandoff.js'
import { enforceEvidenceLevelsOnFindings } from '../core/evidenceLevelEnforcement.js'
import { buildPackageEvidenceIndexes } from '../core/evidencePackageIndexes.js'

export const EVIDENCE_ANALYST_ACTIVITY = Object.freeze({
  STARTED: 'AI_EVIDENCE_ANALYST_STARTED',
  COMPLETED: 'AI_EVIDENCE_ANALYST_COMPLETED',
  FAILED: 'AI_EVIDENCE_ANALYST_FAILED',
})

/**
 * Map AnalyticalFindings into structured explainability fields (no CoT).
 *
 * @param {object} analysis
 * @param {object} evidencePackage
 * @param {{ runId: string, papersAnalyzed: number, bounded: boolean }} meta
 * @returns {object}
 */
function buildExplainabilityPayload(analysis, evidencePackage, meta) {
  const paperById = new Map(
    (evidencePackage?.papers || []).map((p) => [String(p.paperId), p])
  )

  const evidenceLinks = (analysis.findings || []).map((finding) => ({
    findingId: finding.id,
    statement: finding.statement,
    type: finding.type,
    evidenceIds: finding.evidenceIds || [],
    paperIds: finding.paperIds || [],
    preliminaryConfidence: finding.confidence,
  }))

  const sourceAttribution = []
  const seen = new Set()
  for (const finding of analysis.findings || []) {
    for (const paperId of finding.paperIds || []) {
      if (seen.has(paperId)) continue
      seen.add(paperId)
      const paper = paperById.get(paperId)
      sourceAttribution.push({
        paperId,
        source: paper?.source || paper?.provenance?.source || null,
        providers: paper?.provenance?.providers || [],
        title: paper?.title || null,
      })
    }
  }

  const reasoningChains = [
    ...(analysis.themes || []).map((theme) => ({
      kind: 'theme',
      id: theme.id,
      name: theme.name,
      paperIds: theme.paperIds || [],
      evidenceIds: theme.evidenceIds || [],
    })),
    ...(analysis.relationships || []).map((rel) => ({
      kind: 'relationship',
      id: rel.id,
      description: rel.description,
      sourcePaperIds: rel.sourcePaperIds || [],
      graphNodeIds: rel.graphNodeIds || [],
      graphPathIds: rel.graphPathIds || [],
    })),
  ]

  const confidenceScores = {
    preliminary: Object.fromEntries(
      (analysis.findings || []).map((f) => [f.id, f.confidence])
    ),
    note: analysis.confidenceNote,
  }

  const researchGaps = (analysis.gaps || []).map((gap) => ({
    id: gap.id,
    description: gap.description,
    evidenceIds: gap.evidenceIds || [],
    source: 'evidence_analyst',
  }))

  return {
    evidenceLinks,
    sourceAttribution,
    reasoningChains,
    confidenceScores,
    researchGaps,
    status: 'draft',
    metadata: {
      agent: 'evidence_analyst',
      runId: meta.runId,
      papersAnalyzed: meta.papersAnalyzed,
      contextBounded: meta.bounded,
      stage: 'analytical_findings',
      confidenceScope: 'preliminary_only',
      updatedBy: 'evidence_analyst',
    },
  }
}

/**
 * Analyze a validated Explorer EvidencePackage.
 *
 * @param {string} userId
 * @param {{
 *   sessionId: string,
 *   query: string,
 *   evidencePackage: object,
 *   priorAnalyticalFindings?: object|null,
 *   priorCritiqueResult?: object|null
 * }} input
 * @returns {Promise<{
 *   runId: string,
 *   agent: string,
 *   analysis: object,
 *   meta: object
 * }>}
 */
export async function analyzeEvidencePackage(userId, input) {
  const validated = validateEvidenceAnalystInput(input)
  if (!validated.ok) {
    throw new AppError(
      'Invalid evidence analysis request',
      400,
      validated.errors || ['Validation failed']
    )
  }

  const { sessionId, query, evidencePackage, priorAnalyticalFindings, priorCritiqueResult } =
    validated.value

  if (String(evidencePackage.sessionId) !== String(sessionId)) {
    throw new AppError('evidencePackage.sessionId must match sessionId', 400)
  }

  await requireOwnedSession(userId, sessionId)

  const runId = createRunId()
  const safeMeta = getSafeAiMeta()
  const startedAt = Date.now()

  await activityService.createActivity(userId, {
    sessionId,
    type: EVIDENCE_ANALYST_ACTIVITY.STARTED,
    description: 'Evidence Analyst agent started',
    message: 'Evidence Analyst agent started',
    agentId: 'evidence_analyst',
    metadata: {
      runId,
      agent: 'evidence_analyst',
      sessionId,
      paperCount: Array.isArray(evidencePackage.papers)
        ? evidencePackage.papers.length
        : 0,
      provider: safeMeta.provider,
      model: safeMeta.model,
      queryPreview: query.slice(0, 160),
    },
    severity: 'info',
  })

  try {
    const researchQuestion =
      evidencePackage.researchQuestion || query

    const built = buildAnalystContext(evidencePackage, researchQuestion, undefined, {
      priorAnalyticalFindings,
      priorCritiqueResult,
    })
    const papersAnalyzed = built.stats.papersIncluded

    console.info('[AI] evidence_analyst.context_payload', {
      agent: 'evidence_analyst',
      runId,
      sessionId,
      serializedChars: built.payload?.serializedChars,
      estimatedInputTokens: built.payload?.estimatedTokens,
      papers: built.stats.papersIncluded,
      graphNodes: built.stats.nodesIncluded,
      bounded: built.bounded,
    })

    /** @type {object} */
    let analysis
    /** @type {object} */
    let meta = {
      startedAt: new Date(startedAt).toISOString(),
      endedAt: null,
      durationMs: 0,
      success: true,
      model: safeMeta.model,
      provider: safeMeta.provider,
      usage: null,
      contextBounded: built.bounded,
      contextStats: built.stats,
      insufficientEvidence: false,
    }

    if (papersAnalyzed === 0) {
      analysis = buildInsufficientEvidenceAnalysis({
        runId,
        sessionId,
        researchQuestion,
        evidencePackage,
      })
      meta.insufficientEvidence = true
      meta.endedAt = new Date().toISOString()
      meta.durationMs = Date.now() - startedAt
    } else {
      const agent = createEvidenceAnalystAgent({
        runId,
        sessionId,
        researchQuestion,
        allowedPaperIds: built.allowedPaperIds,
        allowedEvidenceIds: built.allowedEvidenceIds,
        allowedNodeIds: built.allowedNodeIds,
        allowedPathIds: built.allowedPathIds,
        evidenceIdToPaperId: built.evidenceIdToPaperId,
      })

      const result = await runAgent(
        agent,
        {
          context: built.context,
        },
        { runId }
      )

      analysis = {
        ...result.output,
        runId,
        sessionId,
        researchQuestion,
        contextStats: built.stats,
      }
      meta = {
        ...result.meta,
        contextBounded: built.bounded,
        contextStats: built.stats,
        insufficientEvidence: false,
      }
    }

    // Cap findings to the Critic/Synthesizer shared profile bound so Critic
    // can evaluate every finding handed downstream (no silent F7 drop).
    const handoff = boundAnalyticalFindingsForHandoff(analysis)
    analysis = handoff.analyticalFindings
    meta.findingsBounded = handoff.bounded
    meta.findingsDroppedIds = handoff.droppedIds

    const indexed = buildPackageEvidenceIndexes(evidencePackage)
    const enforced = enforceEvidenceLevelsOnFindings(
      analysis.findings || [],
      indexed.evidenceItems,
      indexed.evidenceIdToPaperId,
    )
    analysis = {
      ...analysis,
      findings: enforced.findings,
    }
    if (enforced.adjustments.length) {
      meta.evidenceLevelAdjustments = enforced.adjustments
    }

    // Structured provenance only — no Research Report, no hidden CoT
    try {
      await explainabilityService.upsertForSession(userId, sessionId, {
        ...buildExplainabilityPayload(analysis, evidencePackage, {
          runId,
          papersAnalyzed,
          bounded: built.bounded,
        }),
      })
    } catch (explainError) {
      // Analysis still succeeds if explainability upsert fails
      meta.explainabilityUpsertError =
        explainError?.message || 'Explainability upsert failed'
    }

    await activityService.createActivity(userId, {
      sessionId,
      type: EVIDENCE_ANALYST_ACTIVITY.COMPLETED,
      description: 'Evidence Analyst agent completed',
      message: 'Evidence Analyst agent completed',
      agentId: 'evidence_analyst',
      metadata: {
        runId,
        agent: 'evidence_analyst',
        sessionId,
        success: true,
        papersAnalyzed,
        themeCount: analysis.themes?.length || 0,
        findingCount: analysis.findings?.length || 0,
        relationshipCount: analysis.relationships?.length || 0,
        limitationCount: analysis.limitations?.length || 0,
        gapCount: analysis.gaps?.length || 0,
        durationMs: meta.durationMs,
        provider: meta.provider,
        model: meta.model,
        contextBounded: built.bounded,
        insufficientEvidence: Boolean(meta.insufficientEvidence),
      },
      payload: {
        // Structured findings only — no prompts / CoT
        analysisSummary: {
          themes: (analysis.themes || []).map((t) => ({
            id: t.id,
            name: t.name,
            paperIds: t.paperIds,
          })),
          findingIds: (analysis.findings || []).map((f) => f.id),
          gapIds: (analysis.gaps || []).map((g) => g.id),
        },
      },
      severity: 'info',
    })

    return {
      runId,
      agent: 'evidence_analyst',
      analysis,
      meta,
    }
  } catch (error) {
    try {
      await activityService.createActivity(userId, {
        sessionId,
        type: EVIDENCE_ANALYST_ACTIVITY.FAILED,
        description: error?.message || 'Evidence Analyst agent failed',
        message: 'Evidence Analyst agent failed',
        agentId: 'evidence_analyst',
        metadata: {
          runId,
          agent: 'evidence_analyst',
          sessionId,
          success: false,
          code: error?.code || error?.name || 'AI_ERROR',
          provider: safeMeta.provider,
          model: safeMeta.model,
          durationMs: Date.now() - startedAt,
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
 * HTTP body already validated via middleware — still re-check package.
 *
 * @param {string} userId
 * @param {object} body
 */
export async function analyzeEvidenceFromRequest(userId, body) {
  if (!mongoose.Types.ObjectId.isValid(String(body?.sessionId || ''))) {
    throw new AppError('Invalid session id', 400)
  }
  return analyzeEvidencePackage(userId, body)
}

export default {
  analyzeEvidencePackage,
  analyzeEvidenceFromRequest,
  EVIDENCE_ANALYST_ACTIVITY,
}
