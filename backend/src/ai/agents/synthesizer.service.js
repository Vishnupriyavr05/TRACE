/**
 * @fileoverview Synthesizer service — CritiqueResult → ResearchReport.
 * Persists via ResearchReportService. Respects Critic EXCLUDE/QUALIFY/USE_AS_IS.
 */
import mongoose from 'mongoose'
import { requireOwnedSession } from '../../services/researchSession.service.js'
import * as activityService from '../../services/researchActivity.service.js'
import * as explainabilityService from '../../services/explainability.service.js'
import * as researchReportService from '../../services/researchReport.service.js'
import { AppError } from '../../utils/AppError.js'
import { runAgent } from '../core/agentRunner.js'
import { createRunId } from '../core/runId.js'
import { getSafeAiMeta } from '../providers/index.js'
import { createSynthesizerAgent } from './synthesizer.agent.js'
import { buildSynthesizerContext } from './synthesizer.context.js'
import { extractResearchQueryIntents } from '../core/queryIntents.js'
import {
  validateSynthesizerInput,
  mapSynthesisToReportPayload,
  buildInsufficientSynthesis,
  partitionFindingsByCritic,
  extractCriticGapDescriptions,
} from '../validators/synthesizer.schema.js'

/**
 * @param {object|null|undefined} evidencePackage
 * @returns {object[]}
 */
function collectSourceEvidenceItems(evidencePackage) {
  /** @type {object[]} */
  const items = []
  const seen = new Set()
  for (const source of [
    evidencePackage?.allExtractedEvidenceItems,
    evidencePackage?.extractedEvidenceItems,
  ]) {
    if (!Array.isArray(source)) continue
    for (const item of source) {
      const evidenceId = String(item?.evidenceId || '')
      if (!evidenceId || seen.has(evidenceId)) continue
      seen.add(evidenceId)
      items.push(item)
    }
  }
  return items
}

/**
 * @param {object|null|undefined} evidencePackage
 * @returns {Record<string, object>}
 */
function buildExtractedEvidenceById(evidencePackage) {
  /** @type {Record<string, object>} */
  const byId = {}
  for (const item of collectSourceEvidenceItems(evidencePackage)) {
    if (item?.evidenceId) byId[String(item.evidenceId)] = item
  }
  return byId
}

export const SYNTHESIZER_ACTIVITY = Object.freeze({
  STARTED: 'AI_SYNTHESIZER_STARTED',
  COMPLETED: 'AI_SYNTHESIZER_COMPLETED',
  FAILED: 'AI_SYNTHESIZER_FAILED',
})

/**
 * @param {object} synthesis
 * @param {object} critiqueResult
 * @param {{ runId: string }} meta
 * @returns {object}
 */
function buildExplainabilityPayload(synthesis, critiqueResult, meta) {
  const evidenceLinks = (synthesis.findings || []).map((finding) => ({
    findingId: finding.id,
    statement: finding.statement,
    confidence: finding.confidence,
    handling: finding.handling,
    evidenceIds: finding.evidenceIds || [],
    paperIds: finding.paperIds || [],
    source: 'synthesizer',
  }))

  return {
    evidenceLinks,
    confidenceScores: {
      final: Object.fromEntries(
        (synthesis.findings || []).map((f) => [f.id, f.confidence])
      ),
      overall: synthesis.confidence?.overall || 'LOW',
      basis: synthesis.confidence?.basis || '',
      source: 'critic_via_synthesizer',
    },
    contradictions: (critiqueResult.contradictions || []).map((c) => ({
      id: c.id,
      description: c.description,
      findingIds: c.findingIds || [],
      paperIds: c.paperIds || [],
      severity: c.severity,
      source: 'critic',
    })),
    researchGaps: (synthesis.gaps || []).map((description, index) => ({
      id: `SG${index + 1}`,
      description,
      source: 'synthesizer',
    })),
    citationSupport: (synthesis.references || []).map((ref) => ({
      paperId: ref.paperId,
      citation: ref.citation,
      evidenceIds: ref.evidenceIds || [],
    })),
    sourceAttribution: (synthesis.references || []).map((ref) => ({
      paperId: ref.paperId,
      source: ref.source,
      providers: ref.providers || [],
      title: ref.title,
    })),
    status: 'ready',
    metadata: {
      agent: 'synthesizer',
      runId: meta.runId,
      stage: 'research_report',
      excludedFindingIds: synthesis.excludedFindingIds || [],
      qualifiedFindingIds: synthesis.qualifiedFindingIds || [],
      updatedBy: 'synthesizer',
    },
  }
}

/**
 * Synthesize a Research Report from validated TRACE artifacts.
 *
 * @param {string} userId
 * @param {object} input
 * @returns {Promise<{
 *   runId: string,
 *   agent: string,
 *   report: object,
 *   synthesis: object,
 *   meta: object
 * }>}
 */
export async function synthesizeResearchReport(userId, input) {
  const validated = validateSynthesizerInput(input)
  if (!validated.ok) {
    throw new AppError(
      'Invalid synthesizer request',
      400,
      validated.errors || ['Validation failed']
    )
  }

  const {
    sessionId,
    query,
    researchPlan,
    evidencePackage,
    analyticalFindings,
    critiqueResult,
  } = validated.value

  await requireOwnedSession(userId, sessionId)

  const runId = createRunId()
  const safeMeta = getSafeAiMeta()
  const startedAt = Date.now()
  const researchQuestion =
    analyticalFindings.researchQuestion ||
    evidencePackage.researchQuestion ||
    query

  const partition = partitionFindingsByCritic(
    analyticalFindings,
    critiqueResult
  )

  await activityService.createActivity(userId, {
    sessionId,
    type: SYNTHESIZER_ACTIVITY.STARTED,
    description: 'Synthesizer agent started',
    message: 'Synthesizer agent started',
    agentId: 'synthesizer',
    metadata: {
      runId,
      agent: 'synthesizer',
      sessionId,
      findingsTotal: analyticalFindings.findings?.length || 0,
      findingsIncludable: partition.includable.length,
      findingsExcluded: partition.excluded.length,
      provider: safeMeta.provider,
      model: safeMeta.model,
      queryPreview: query.slice(0, 160),
    },
    severity: 'info',
  })

  /** @type {object|null} */
  let payloadDiagnostics = null
  /** @type {object|null} */
  let synthesizerBuilt = null

  try {
    /** @type {object} */
    let synthesis
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
      usedLlm: false,
      insufficientPath: false,
    }

    const sufficiency =
      critiqueResult.overallAssessment?.evidenceSufficiency || 'INSUFFICIENT'

    if (
      partition.includable.length === 0 ||
      (evidencePackage.papers || []).length === 0
    ) {
      synthesis = buildInsufficientSynthesis({
        researchQuestion,
        researchPlan,
        critiqueResult,
        evidencePackage,
      })
      meta.insufficientPath = true
      meta.endedAt = new Date().toISOString()
      meta.durationMs = Date.now() - startedAt
    } else {
      synthesizerBuilt = buildSynthesizerContext({
        researchPlan,
        evidencePackage,
        analyticalFindings,
        critiqueResult,
        researchQuestion,
      })

      payloadDiagnostics = {
        findings: synthesizerBuilt.payload?.findings,
        papers: synthesizerBuilt.payload?.papers,
        evidenceItems: synthesizerBuilt.payload?.evidenceItems,
        critiqueEvaluations: synthesizerBuilt.payload?.critiqueEvaluations,
        contradictions: synthesizerBuilt.payload?.contradictions,
        gaps: synthesizerBuilt.payload?.gaps,
        references: synthesizerBuilt.payload?.references,
        graphNodes: synthesizerBuilt.payload?.graphNodes ?? 0,
        graphEdges: synthesizerBuilt.payload?.graphEdges ?? 0,
        chars: synthesizerBuilt.payload?.serializedChars,
        estimatedTokens: synthesizerBuilt.payload?.estimatedTokens,
        bounded: synthesizerBuilt.bounded,
      }
      console.info('[AI] synthesizer.context_payload', {
        ...safeMeta,
        agent: 'synthesizer',
        runId,
        ...payloadDiagnostics,
      })

      const agent = createSynthesizerAgent({
        runId,
        sessionId,
        researchQuestion,
        researchPlanObjective: researchPlan?.objective || '',
        criticGapDescriptions: extractCriticGapDescriptions(
          critiqueResult,
          evidencePackage,
          researchQuestion,
        ),
        targetGapDescriptions: synthesizerBuilt.evidenceChain?.scientificGaps || [],
        criticContradictions: critiqueResult.contradictions || [],
        evidenceMatrixRelevantCount:
          synthesizerBuilt.matrixCoverage?.relevantCount || 0,
        evidenceChain: synthesizerBuilt.evidenceChain,
        matrixCoverage: synthesizerBuilt.matrixCoverage,
        comparisonSufficiency: synthesizerBuilt.comparisonSufficiency,
        queryIntents: extractResearchQueryIntents(researchQuestion),
        allowedFindingIds: synthesizerBuilt.allowedFindingIds,
        excludedFindingIds: synthesizerBuilt.excludedFindingIds,
        qualifyFindingIds: synthesizerBuilt.qualifyFindingIds,
        criticConfidenceByFinding: synthesizerBuilt.criticConfidenceByFinding,
        overallCriticConfidence:
          critiqueResult.overallAssessment?.confidence || 'LOW',
        overallSufficiency: sufficiency,
        allowedPaperIds: synthesizerBuilt.allowedPaperIds,
        papersById: synthesizerBuilt.papersById,
        allowedEvidenceIds: synthesizerBuilt.allowedEvidenceIds,
        evidenceIdToPaperId: synthesizerBuilt.evidenceIdToPaperId,
        extractedEvidenceById: buildExtractedEvidenceById(evidencePackage),
      })

      const result = await runAgent(
        agent,
        { context: synthesizerBuilt.context },
        { runId }
      )

      synthesis = {
        ...result.output,
        excludedFindingIds: [...synthesizerBuilt.excludedFindingIds],
        qualifiedFindingIds: [...synthesizerBuilt.qualifyFindingIds],
      }
      meta = {
        ...result.meta,
        contextBounded: synthesizerBuilt.bounded,
        contextStats: synthesizerBuilt.stats,
        payloadDiagnostics,
        usedLlm: true,
        insufficientPath: false,
      }
    }

    const reportPayload = mapSynthesisToReportPayload(synthesis, {
      runId,
      sessionId,
      provider: meta.provider,
      model: meta.model,
      excludedCount: synthesis.excludedFindingIds?.length || partition.excluded.length,
      qualifiedCount:
        synthesis.qualifiedFindingIds?.length ||
        partition.byHandling.QUALIFY.length,
      paperCount: evidencePackage.papers?.length || 0,
      corpusPapers: evidencePackage.papers || [],
      sourceEvidenceItems: collectSourceEvidenceItems(evidencePackage),
      extractedEvidenceItems: evidencePackage.extractedEvidenceItems || [],
      allExtractedEvidenceItems: evidencePackage.allExtractedEvidenceItems || [],
      researchQuestion: evidencePackage.researchQuestion || query || '',
      evidencePackage,
      matrixCoverage: synthesizerBuilt?.matrixCoverage || null,
      coverageConfidenceCeiling:
        synthesizerBuilt?.evidenceChain?.coverageConfidenceCeiling || 'LOW',
      comparisonSufficiency: synthesizerBuilt?.comparisonSufficiency || null,
      retrievalObservability: evidencePackage.retrievalObservability || null,
      // Temporary observability only: records the already-selected synthesis
      // context papers without changing the context or synthesis behavior.
      synthesizerPaperIds: [...(synthesizerBuilt?.allowedPaperIds || [])],
      evidenceIdToPaperId:
        synthesizerBuilt?.evidenceIdToPaperId ||
        new Map(
          (evidencePackage.evidenceItems || []).map((item) => [
            String(item.evidenceId),
            String(item.paperId),
          ]),
        ),
    })

    // Persist ONLY after validation succeeded (map input already validated)
    const persisted = await researchReportService.upsertForSession(
      userId,
      sessionId,
      reportPayload
    )

    try {
      await explainabilityService.upsertForSession(userId, sessionId, {
        ...buildExplainabilityPayload(synthesis, critiqueResult, { runId }),
        reportId: persisted._id || persisted.id || null,
      })
    } catch (explainError) {
      meta.explainabilityUpsertError =
        explainError?.message || 'Explainability upsert failed'
    }

    await activityService.createActivity(userId, {
      sessionId,
      type: SYNTHESIZER_ACTIVITY.COMPLETED,
      description: 'Synthesizer agent completed',
      message: 'Synthesizer agent completed',
      agentId: 'synthesizer',
      metadata: {
        runId,
        agent: 'synthesizer',
        sessionId,
        success: true,
        reportId: String(persisted._id || persisted.id || ''),
        findingsUsed: synthesis.findings?.length || 0,
        findingsExcluded:
          synthesis.excludedFindingIds?.length || partition.excluded.length,
        findingsQualified:
          synthesis.qualifiedFindingIds?.length ||
          partition.byHandling.QUALIFY.length,
        referencesUsed: synthesis.references?.length || 0,
        contradictions: synthesis.contradictions?.length || 0,
        gaps: synthesis.gaps?.length || 0,
        overallConfidence: synthesis.confidence?.overall || 'LOW',
        reportStatus: persisted.status,
        durationMs: meta.durationMs,
        provider: meta.provider,
        model: meta.model,
        usedLlm: Boolean(meta.usedLlm),
        ...(payloadDiagnostics ? { payloadDiagnostics } : {}),
      },
      payload: {
        reportSummary: {
          reportId: String(persisted._id || persisted.id || ''),
          status: persisted.status,
          findingIds: (synthesis.findings || []).map((f) => f.id),
          overallConfidence: synthesis.confidence?.overall,
        },
      },
      severity: 'info',
    })

    return {
      runId,
      agent: 'synthesizer',
      report: persisted,
      synthesis,
      meta,
    }
  } catch (error) {
    try {
      await activityService.createActivity(userId, {
        sessionId,
        type: SYNTHESIZER_ACTIVITY.FAILED,
        description: error?.message || 'Synthesizer agent failed',
        message: 'Synthesizer agent failed',
        agentId: 'synthesizer',
        metadata: {
          runId,
          agent: 'synthesizer',
          sessionId,
          success: false,
          code: error?.code || error?.name || 'AI_ERROR',
          statusCode: error?.statusCode,
          provider: safeMeta.provider,
          model: safeMeta.model,
          durationMs: Date.now() - startedAt,
          ...(payloadDiagnostics ? { payloadDiagnostics } : {}),
        },
        severity: 'error',
      })
    } catch {
      // ignore activity write failures
    }
    throw error
  }
}

/**
 * @param {string} userId
 * @param {object} body
 */
export async function synthesizeFromRequest(userId, body) {
  if (!mongoose.Types.ObjectId.isValid(String(body?.sessionId || ''))) {
    throw new AppError('Invalid session id', 400)
  }
  return synthesizeResearchReport(userId, body)
}

export default {
  synthesizeResearchReport,
  synthesizeFromRequest,
  SYNTHESIZER_ACTIVITY,
}
