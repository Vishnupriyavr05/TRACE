/**
 * @fileoverview Research Orchestrator — deterministic TRACE workflow coordinator.
 *
 * Calls existing agent services in-process. Not a sixth reasoning agent.
 * Max agent calls (normal): Planner1 Explorer1 Analyst1 Critic1 Synthesizer1
 * With refinement: Explorer2 Analyst2 Critic2 (+ Planner1 Synthesizer1)
 *
 * Observability: per-TRACE LLM accounting, checkpoints for resumability,
 * deterministic quality metrics (no extra LLM judge).
 */
import { requireOwnedSession } from '../../services/researchSession.service.js'
import * as researchSessionService from '../../services/researchSession.service.js'
import * as activityService from '../../services/researchActivity.service.js'
import * as researchReportService from '../../services/researchReport.service.js'
import { AppError } from '../../utils/AppError.js'
import { createRunId } from '../core/runId.js'
import { getSafeAiMeta } from '../providers/index.js'
import { TRACE_MAX_LLM_CALLS } from '../../config/environment/env.js'
import { createResearchPlan } from '../agents/planner.service.js'
import { exploreResearchPlan } from '../agents/explorer.service.js'
import { analyzeEvidencePackage } from '../agents/evidenceAnalyst.service.js'
import { critiqueAnalyticalFindings } from '../agents/critic.service.js'
import { synthesizeResearchReport } from '../agents/synthesizer.service.js'
import { validateResearchOrchestratorInput } from '../validators/researchOrchestrator.schema.js'
import { shouldRefine, MAX_REFINEMENTS } from './refinementDecider.js'
import { mergeEvidencePackages } from './evidenceMerge.js'
import {
  CHECKPOINT_ACTIVITY,
  buildCheckpointActivity,
  selectResumeState,
} from './researchCheckpoint.js'
import {
  createTraceAccounting,
  runWithTraceAccounting,
  snapshotTraceAccounting,
} from '../core/llmAccounting.js'
import { computeTraceQualityMetrics } from '../quality/traceQualityMetrics.js'
import { evaluateQualityGate } from '../quality/qualityGate.js'
import { getTraceProfile } from '../core/traceProfile.js'
import {
  boundAnalyticalFindingsForHandoff,
  prepareSynthesisHandoffWithRepair,
} from '../core/findingsHandoff.js'
import {
  assertSynthesisLifecycleComplete,
  attachOrchestrationFailure,
  buildFinalSynthesisEvidencePackage,
  closeRefinementGate,
  POST_REFINEMENT_SYNTHESIS_STAGE,
} from './orchestratorLifecycle.js'
import { isRateLimitError } from '../core/llmClient.js'
import {
  formatProviderRateLimitUserMessage,
  getProviderCooldownState,
} from '../core/providerCircuit.js'
import { awaitProviderTpmHeadroom, canAffordRefinementCycle } from '../core/contextBudget.js'
import {
  acquireFullTextEvidence,
  attachAcquisitionToEvidencePackage,
} from '../../services/fullTextAcquisition.service.js'
import {
  acquireTraceLock,
  releaseTraceLock,
} from '../core/traceLock.js'
import { buildSessionKnowledgeGraph } from '../../knowledgeGraph/knowledgeGraph.builder.js'
import { performance } from 'node:perf_hooks'
import { auditFullTextLineage } from '../core/evidenceLineage.js'
import {
  createTracePerf,
  runWithTracePerf,
  getTracePerf,
  timeStage,
  recordAgentTiming,
  recordCooldownMs,
  recordFullTextAcquisition,
  recordGraphBuild,
  finalizeTracePerf,
  logTracePerf,
} from '../core/tracePerf.js'
import { finalizeRetrievalAudit } from '../core/retrievalAudit.js'
import { buildPackageEvidenceIndexes } from '../core/evidencePackageIndexes.js'
import {
  EVIDENCE_LEVEL,
  normalizeEvidenceLevel,
} from '../core/evidenceLevels.js'

async function patchReportMetadata(userId, report, updates) {
  const reportId = String(report?._id || report?.id || '')
  if (!reportId) return report
  try {
    return await researchReportService.updateReport(userId, reportId, updates)
  } catch {
    return report
  }
}

/**
 * @param {object} plan
 * @returns {object[]}
 */
function plannerSearchQueriesForObservability(plan) {
  return (plan?.searchQueries || []).map((row) =>
    typeof row === 'string'
      ? { query: row }
      : { query: row?.query || '', purpose: row?.purpose || '' },
  )
}

/**
 * @param {{
 *   query: string,
 *   evidencePackage: object,
 *   analyticalFindings: object,
 *   report: object
 * }} input
 * @returns {object}
 */
function buildRetrievalAuditForRun(input) {
  const evidencePackage = input.evidencePackage || {}
  const indexes = buildPackageEvidenceIndexes(evidencePackage)
  const fullTextPaperIds = Object.entries(
    evidencePackage.paperEvidenceLevels || {},
  )
    .filter(
      ([, level]) =>
        normalizeEvidenceLevel(level) === EVIDENCE_LEVEL.FULL_TEXT,
    )
    .map(([paperId]) => paperId)

  return finalizeRetrievalAudit(
    evidencePackage?.retrievalObservability?.retrievalAudit || null,
    {
      evidencePackage,
      analyticalFindings: input.analyticalFindings || {},
      report: input.report || {},
      analystPaperIds: [...indexes.allowedPaperIds],
      fullTextPaperIds,
    },
  )
}

/**
 * @param {object|null|undefined} evidencePackage
 * @param {object} retrievalAudit
 * @returns {object}
 */
function mergeRetrievalObservability(evidencePackage, retrievalAudit) {
  return {
    ...(evidencePackage?.retrievalObservability || {}),
    retrievalAudit,
  }
}

/**
 * @param {object} meta
 * @param {object|null} llmUsage
 * @returns {object}
 */
function withTracePerfMeta(meta, llmUsage) {
  const perf = getTracePerf()
  if (!perf) return meta
  const summary = finalizeTracePerf(perf, { llmUsage })
  logTracePerf(summary)
  return { ...meta, perf: summary }
}

export const RESEARCH_ACTIVITY = Object.freeze({
  STARTED: 'AI_RESEARCH_STARTED',
  CHECKPOINT: CHECKPOINT_ACTIVITY,
  REFINEMENT_COMPLETED: 'AI_RESEARCH_REFINEMENT_COMPLETED',
  COMPLETED: 'AI_RESEARCH_COMPLETED',
  FAILED: 'AI_RESEARCH_FAILED',
  PROVIDER_RATE_LIMITED: 'AI_PROVIDER_RATE_LIMITED',
})

export const WORKFLOW_STAGE = Object.freeze({
  PLANNING: 'PLANNING',
  EXPLORING: 'EXPLORING',
  ANALYZING: 'ANALYZING',
  CRITIQUING: 'CRITIQUING',
  REFINING: 'REFINING',
  SYNTHESIZING: 'SYNTHESIZING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
})

/**
 * Optional pause between LLM-heavy stages (helps provider rate limits).
 * Default 0 — enable via ORCHESTRATOR_STAGE_COOLDOWN_MS.
 * When minimum-profile TPM headroom is low, may wait for provider reset.
 *
 * @param {string} [nextAgent] — agent id for the upcoming LLM stage
 * @returns {Promise<void>}
 */
async function stageCooldown(nextAgent = null) {
  const cooldownStart = performance.now()
  const ms = Number(process.env.ORCHESTRATOR_STAGE_COOLDOWN_MS) || 0
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
  if (nextAgent) {
    await awaitProviderTpmHeadroom(nextAgent)
  }
  recordCooldownMs(performance.now() - cooldownStart)
}

/**
 * @returns {object}
 */
function emptyWorkflow() {
  return {
    planner: 'pending',
    explorer: 'pending',
    evidenceAnalyst: 'pending',
    critic: 'pending',
    synthesizer: 'pending',
    refinement: {
      attempted: false,
      completed: false,
      gate: 'OPEN',
      count: 0,
      reasons: [],
      additionalQueries: [],
    },
    resumedFrom: null,
  }
}

/**
 * @param {object} basePlan
 * @param {object[]} refinementQueries
 * @returns {object}
 */
function buildRefinementPlan(basePlan, refinementQueries) {
  return {
    ...basePlan,
    searchQueries: (refinementQueries || []).map((q) => ({
      query: q.query,
      purpose: q.purpose || 'refinement',
      ...(q.evidenceTargetIds ? { evidenceTargetIds: q.evidenceTargetIds } : {}),
      ...(q.methodLabel ? { methodLabel: q.methodLabel } : {}),
      ...(q.evaluationDimension
        ? { evaluationDimension: q.evaluationDimension }
        : {}),
      ...(q.recovery ? { recovery: true } : {}),
      ...(q.methodSpecific ? { methodSpecific: true } : {}),
    })),
    evidenceRequirements: basePlan.evidenceRequirements || [],
    researchDimensions: basePlan.researchDimensions || [],
    objective: basePlan.objective,
    subQuestions: basePlan.subQuestions || [],
    stoppingCriteria: basePlan.stoppingCriteria || [],
  }
}

/**
 * Run deterministic full-text acquisition before Evidence Analyst stages.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {object|null} evidencePackage
 * @param {string} query
 * @param {{ acquisitionPhase?: 'initial' | 'refinement' }} [options]
 * @returns {Promise<object|null>}
 */
async function enrichEvidencePackageWithFullText(
  userId,
  sessionId,
  evidencePackage,
  query,
  options = {},
) {
  if (!evidencePackage?.papers?.length) return evidencePackage
  const ftStart = performance.now()
  const acquisitionPhase = options.acquisitionPhase || 'initial'
  const acquisition = await acquireFullTextEvidence(
    userId,
    sessionId,
    {
      ...evidencePackage,
      researchQuestion: evidencePackage.researchQuestion || query,
    },
    { acquisitionPhase },
  )
  recordFullTextAcquisition(
    acquisition?.stats,
    performance.now() - ftStart,
    acquisition?.paperOutcomes,
    { phase: acquisitionPhase },
  )
  return attachAcquisitionToEvidencePackage(evidencePackage, acquisition)
}

/**
 * @param {string} userId
 * @param {object} fields
 */
async function persistCheckpoint(userId, fields) {
  try {
    await activityService.createActivity(
      userId,
      buildCheckpointActivity(fields),
    )
  } catch {
    // Non-fatal — resume may be unavailable if checkpoint write fails
  }
}

/**
 * @param {string} userId
 * @param {object} fields
 */
async function emitRefinementCompleted(userId, fields) {
  try {
    await activityService.createActivity(userId, {
      sessionId: fields.sessionId,
      type: RESEARCH_ACTIVITY.REFINEMENT_COMPLETED,
      description: 'Research refinement completed',
      message: 'Research refinement completed',
      agentId: 'orchestrator',
      metadata: {
        runId: fields.runId,
        agent: 'orchestrator',
        sessionId: fields.sessionId,
        stage: WORKFLOW_STAGE.REFINING,
        queryPreview: String(fields.query || '').slice(0, 160),
        refinementAttempt: fields.refinementAttempt,
        refinementOutcome: fields.refinementOutcome || 'completed',
        nextStage: WORKFLOW_STAGE.SYNTHESIZING,
      },
      payload: {
        workflow: fields.workflow,
        refinement: fields.workflow?.refinement || null,
      },
      severity: 'info',
    })
  } catch {
    // Non-fatal
  }
}

/**
 * Load resume artifacts from prior failed TRACE on this session/query.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {string} query
 */
async function loadResumeState(userId, sessionId, query) {
  try {
    const listed = await activityService.listSessionActivities(
      userId,
      sessionId,
      { page: 1, limit: 100 },
    )
    return selectResumeState(listed.activities || [], query)
  } catch {
    return selectResumeState([], query)
  }
}

/**
 * Execute the full TRACE research workflow for an owned session.
 *
 * @param {string} userId
 * @param {{ sessionId: string, query: string }} input
 * @returns {Promise<object>}
 */
export async function runResearch(userId, input) {
  const validated = validateResearchOrchestratorInput(input)
  if (!validated.ok) {
    throw new AppError(
      'Invalid research request',
      400,
      validated.errors || ['Validation failed']
    )
  }

  const { sessionId, query } = validated.value
  await requireOwnedSession(userId, sessionId)

  const orchestrationRunId = createRunId()
  acquireTraceLock(userId, sessionId, orchestrationRunId)

  const accounting = createTraceAccounting({
    runId: orchestrationRunId,
    maxCalls: TRACE_MAX_LLM_CALLS,
  })

  try {
    return await runWithTraceAccounting(accounting, () =>
      runWithTracePerf(createTracePerf(orchestrationRunId), () =>
        runResearchInner(userId, {
          sessionId,
          query,
          orchestrationRunId,
          accounting,
        }),
      ),
    )
  } finally {
    releaseTraceLock(userId, orchestrationRunId)
  }
}

/**
 * @param {string} userId
 * @param {object} ctx
 * @returns {Promise<object>}
 */
async function runResearchInner(userId, ctx) {
  const { sessionId, query, orchestrationRunId, accounting } = ctx
  const safeMeta = getSafeAiMeta()
  const startedAt = Date.now()

  /** @type {object} */
  const workflow = emptyWorkflow()
  /** @type {string} */
  let stage = WORKFLOW_STAGE.PLANNING

  /** @type {object|null} */
  let plan = null
  /** @type {object|null} */
  let evidencePackage = null
  /** @type {object|null} */
  let analyticalFindings = null
  /** @type {object|null} */
  let critiqueResult = null
  /** @type {object|null} */
  let report = null

  /** @type {object} */
  const agentRunIds = {}

  const resume = await loadResumeState(userId, sessionId, query)
  if (resume.resumable) {
    workflow.resumedFrom = resume.resumeFrom
    if (resume.workflow?.refinement) {
      workflow.refinement = {
        ...workflow.refinement,
        ...resume.workflow.refinement,
      }
    }
    plan = resume.plan
    evidencePackage = resume.evidencePackage
    analyticalFindings = resume.analyticalFindings
    critiqueResult = resume.critiqueResult
    if (plan) {
      workflow.planner = 'completed'
      agentRunIds.planner = resume.sourceRunId || 'resumed'
    }
    if (evidencePackage) {
      workflow.explorer = 'completed'
      agentRunIds.explorer = resume.sourceRunId || 'resumed'
    }
    if (analyticalFindings) {
      workflow.evidenceAnalyst = 'completed'
      agentRunIds.evidenceAnalyst = resume.sourceRunId || 'resumed'
    }
    if (critiqueResult) {
      workflow.critic = 'completed'
      agentRunIds.critic = resume.sourceRunId || 'resumed'
    }
  }

  await activityService.createActivity(userId, {
    sessionId,
    type: RESEARCH_ACTIVITY.STARTED,
    description: resume.resumable
      ? `Research orchestration resumed from ${resume.resumeFrom}`
      : 'Research orchestration started',
    message: resume.resumable
      ? `Research orchestration resumed from ${resume.resumeFrom}`
      : 'Research orchestration started',
    agentId: 'orchestrator',
    metadata: {
      runId: orchestrationRunId,
      agent: 'orchestrator',
      sessionId,
      query,
      queryPreview: query.slice(0, 160),
      provider: safeMeta.provider,
      model: safeMeta.model,
      maxRefinements: MAX_REFINEMENTS,
      maxLlmCalls: accounting.maxCalls,
      traceProfile: getTraceProfile().name,
      resumedFrom: resume.resumable ? resume.resumeFrom : null,
      priorRunId: resume.sourceRunId || null,
    },
    severity: 'info',
  })

  try {
    // ── 1. Planner ──────────────────────────────────────────────
    if (!plan) {
      stage = WORKFLOW_STAGE.PLANNING
      const planned = await timeStage('plannerMs', () =>
        createResearchPlan(userId, { sessionId, query }),
      )
      plan = planned.plan
      agentRunIds.planner = planned.runId
      workflow.planner = 'completed'
      recordAgentTiming('planner', planned.meta)
      await persistCheckpoint(userId, {
        sessionId,
        runId: orchestrationRunId,
        query,
        stage: WORKFLOW_STAGE.PLANNING,
        workflow,
        plan,
      })
    }

    // ── 2. Explorer ─────────────────────────────────────────────
    if (!evidencePackage) {
      stage = WORKFLOW_STAGE.EXPLORING
      await stageCooldown('explorer')
      const explored = await timeStage('explorerMs', () =>
        exploreResearchPlan(userId, {
          sessionId,
          query,
          plan,
        }),
      )
      evidencePackage = explored.evidencePackage
      agentRunIds.explorer = explored.runId
      workflow.explorer = 'completed'
      recordAgentTiming('explorer', explored.meta)
      await persistCheckpoint(userId, {
        sessionId,
        runId: orchestrationRunId,
        query,
        stage: WORKFLOW_STAGE.EXPLORING,
        workflow,
        plan,
        evidencePackage,
      })
    }

    // ── 3. Evidence Analyst ─────────────────────────────────────
    if (!analyticalFindings) {
      stage = WORKFLOW_STAGE.ANALYZING
      evidencePackage = await timeStage('fullTextMs', () =>
        enrichEvidencePackageWithFullText(
          userId,
          sessionId,
          evidencePackage,
          query,
          { acquisitionPhase: 'initial' },
        ),
      )
      await stageCooldown('evidence_analyst')
      const analyzed = await timeStage('analystMs', () =>
        analyzeEvidencePackage(userId, {
          sessionId,
          query,
          evidencePackage,
        }),
      )
      analyticalFindings = analyzed.analysis
      agentRunIds.evidenceAnalyst = analyzed.runId
      workflow.evidenceAnalyst = 'completed'
      recordAgentTiming('evidence_analyst', analyzed.meta)
      await persistCheckpoint(userId, {
        sessionId,
        runId: orchestrationRunId,
        query,
        stage: WORKFLOW_STAGE.ANALYZING,
        workflow,
        plan,
        evidencePackage,
        analyticalFindings,
      })
    }

    // ── 4. Critic ───────────────────────────────────────────────
    // Bound Analyst findings to Critic max before critique so the Critic
    // context slice cannot silently drop findings the Synthesizer requires.
    {
      const handoff = boundAnalyticalFindingsForHandoff(analyticalFindings)
      analyticalFindings = handoff.analyticalFindings
    }

    if (!critiqueResult) {
      stage = WORKFLOW_STAGE.CRITIQUING
      await stageCooldown('critic')
      const critiqued = await timeStage('criticMs', () =>
        critiqueAnalyticalFindings(userId, {
          sessionId,
          query,
          evidencePackage,
          analyticalFindings,
        }),
      )
      critiqueResult = critiqued.critique
      agentRunIds.critic = critiqued.runId
      workflow.critic = 'completed'
      recordAgentTiming('critic', critiqued.meta)
      await persistCheckpoint(userId, {
        sessionId,
        runId: orchestrationRunId,
        query,
        stage: WORKFLOW_STAGE.CRITIQUING,
        workflow,
        plan,
        evidencePackage,
        analyticalFindings,
        critiqueResult,
      })
    }

    // ── 5. Optional ONE refinement cycle ────────────────────────
    // Skip re-refinement when resuming past critic with a prior refinement already applied
    let refinementCount = workflow.refinement?.count || 0
    const decision = shouldRefine(critiqueResult, plan, refinementCount, {
      evidencePackage,
      query,
      analyticalFindings,
    })

    if (decision.shouldRefine && refinementCount < MAX_REFINEMENTS) {
      const envelopeCheck = canAffordRefinementCycle(accounting)
      if (!envelopeCheck.allowed) {
        workflow.refinement = {
          attempted: false,
          count: refinementCount,
          reasons: [
            ...decision.reasons,
            envelopeCheck.reason ||
              'Refinement skipped: TRACE token envelope insufficient',
          ],
          additionalQueries: decision.queries,
          skippedDueToTokenEnvelope: true,
          envelopeDiagnostics: envelopeCheck,
        }
      } else {
      stage = WORKFLOW_STAGE.REFINING
      await persistCheckpoint(userId, {
        sessionId,
        runId: orchestrationRunId,
        query,
        stage: WORKFLOW_STAGE.REFINING,
        workflow,
        plan,
        evidencePackage,
        analyticalFindings,
        critiqueResult,
      })
      const perf = getTracePerf()
      if (perf) perf.refinement = true
      await stageCooldown('explorer')
      refinementCount = 1
      workflow.refinement = {
        attempted: true,
        count: refinementCount,
        reasons: decision.reasons,
        additionalQueries: decision.queries,
        coverageGateVerdict: decision.coverageSufficiency?.gateVerdict || null,
      }

      const refinementPlan = buildRefinementPlan(plan, decision.queries)
      const refinedExplore = await timeStage('explorerRefineMs', () =>
        exploreResearchPlan(userId, {
          sessionId,
          query,
          plan: refinementPlan,
        }),
      )
      agentRunIds.explorerRefinement = refinedExplore.runId
      recordAgentTiming('explorer_refinement', refinedExplore.meta)

      evidencePackage = mergeEvidencePackages(
        evidencePackage,
        refinedExplore.evidencePackage,
        { runId: orchestrationRunId }
      )

      evidencePackage = await timeStage('fullTextRefineMs', () =>
        enrichEvidencePackageWithFullText(
          userId,
          sessionId,
          evidencePackage,
          query,
          { acquisitionPhase: 'refinement' },
        ),
      )

      await stageCooldown('evidence_analyst')
      const reanalyzed = await timeStage('analystRefineMs', () =>
        analyzeEvidencePackage(userId, {
          sessionId,
          query,
          evidencePackage,
          priorAnalyticalFindings: analyticalFindings,
          priorCritiqueResult: critiqueResult,
        }),
      )
      analyticalFindings = reanalyzed.analysis
      agentRunIds.evidenceAnalystRefinement = reanalyzed.runId
      recordAgentTiming('evidence_analyst_refinement', reanalyzed.meta)

      {
        const handoff = boundAnalyticalFindingsForHandoff(analyticalFindings)
        analyticalFindings = handoff.analyticalFindings
      }

      await stageCooldown('critic')
      const recritiqued = await timeStage('criticRefineMs', () =>
        critiqueAnalyticalFindings(userId, {
          sessionId,
          query,
          evidencePackage,
          analyticalFindings,
        }),
      )
      critiqueResult = recritiqued.critique
      agentRunIds.criticRefinement = recritiqued.runId
      recordAgentTiming('critic_refinement', recritiqued.meta)

      Object.assign(workflow, closeRefinementGate(workflow))
      workflow.refinement.secondRefinementBlocked = true
      workflow.refinement.blockedReasons = [
        'Refinement gate closed after one bounded cycle; synthesis is next.',
      ]

      await persistCheckpoint(userId, {
        sessionId,
        runId: orchestrationRunId,
        query,
        stage: WORKFLOW_STAGE.REFINING,
        workflow,
        plan,
        evidencePackage,
        analyticalFindings,
        critiqueResult,
      })

      await emitRefinementCompleted(userId, {
        sessionId,
        runId: orchestrationRunId,
        query,
        workflow,
        refinementAttempt: refinementCount,
        refinementOutcome: 'completed',
      })
      }
    } else if (!workflow.refinement?.attempted) {
      workflow.refinement = {
        attempted: false,
        completed: false,
        gate: 'OPEN',
        count: 0,
        reasons: decision.reasons,
        additionalQueries: [],
      }
    }

    if (workflow.refinement?.attempted) {
      workflow.refinement.gate = 'CLOSED'
      workflow.refinement.completed = true
    }

    // ── 6. Synthesizer (always uses post-refinement / latest artifacts) ──
    stage = WORKFLOW_STAGE.SYNTHESIZING
    workflow.synthesizer = 'started'

    await persistCheckpoint(userId, {
      sessionId,
      runId: orchestrationRunId,
      query,
      stage: WORKFLOW_STAGE.SYNTHESIZING,
      workflow,
      plan,
      evidencePackage,
      analyticalFindings,
      critiqueResult,
    })

    try {
      const synthHandoff = prepareSynthesisHandoffWithRepair(
        analyticalFindings,
        critiqueResult,
        { allowRepair: Boolean(workflow.refinement?.attempted) },
      )
      if (!synthHandoff.ok) {
        throw new AppError(
          `Invalid synthesizer request: ${(synthHandoff.errors || []).join('; ')}`,
          400,
        )
      }
      analyticalFindings = synthHandoff.analyticalFindings
      critiqueResult = synthHandoff.critiqueResult
      if (synthHandoff.repaired) {
        workflow.synthesisHandoffRepaired = true
        workflow.synthesisHandoffDroppedFindingIds =
          synthHandoff.droppedFindingIds || []
      }

      await stageCooldown('synthesizer')
      evidencePackage = buildFinalSynthesisEvidencePackage(
        evidencePackage,
        query,
        analyticalFindings,
        Boolean(workflow.refinement?.attempted),
      )

      const synthesized = await timeStage('synthesizerMs', () =>
        synthesizeResearchReport(userId, {
          sessionId,
          query,
          researchPlan: plan,
          evidencePackage,
          analyticalFindings,
          critiqueResult,
        }),
      )
      report = synthesized.report
      agentRunIds.synthesizer = synthesized.runId
      workflow.synthesizer = 'completed'
      recordAgentTiming('synthesizer', synthesized.meta)
    } catch (transitionError) {
      evidencePackage = attachOrchestrationFailure(evidencePackage, {
        stage: POST_REFINEMENT_SYNTHESIS_STAGE,
        error:
          transitionError?.message ||
          String(transitionError || 'Unknown synthesis transition error'),
        refinementAttempt: workflow.refinement?.count || 0,
        refinementOutcome: workflow.refinement?.completed
          ? 'completed'
          : workflow.refinement?.attempted
            ? 'incomplete'
            : 'skipped',
        synthesizerStarted: workflow.synthesizer === 'started',
        synthesizerCompleted: workflow.synthesizer === 'completed',
      })
      throw transitionError
    }

    const lifecycle = assertSynthesisLifecycleComplete(
      workflow,
      report,
      agentRunIds,
    )
    if (!lifecycle.ok) {
      throw new AppError(
        `TRACE lifecycle incomplete: ${lifecycle.errors.join('; ')}`,
        502,
      )
    }

    if (!report || report.status !== 'ready') {
      throw new AppError(
        'Synthesizer did not produce a ready ResearchReport',
        502
      )
    }
    if (String(report.sessionId) !== String(sessionId)) {
      throw new AppError('Synthesized report session mismatch', 502)
    }

    let graphBuildResult = null
    let graphPersisted = false
    try {
      graphBuildResult = await timeStage('graphMs', () =>
        buildSessionKnowledgeGraph(userId, sessionId, {
          scope: 'final',
          traceArtifacts: {
            analyticalFindings,
            evidencePackage,
          },
        }),
      )
      const nodeCount =
        graphBuildResult?.stats?.nodeCount ||
        graphBuildResult?.graph?.nodes?.length ||
        0
      graphPersisted =
        graphBuildResult?.buildStatus === 'completed' && Number(nodeCount) > 0
      recordGraphBuild({
        durationMs: getTracePerf()?.stages?.graphMs ?? null,
        nodeCount: Number(nodeCount) || 0,
        linkCount:
          graphBuildResult?.stats?.linkCount ||
          graphBuildResult?.graph?.links?.length ||
          0,
        persisted: graphPersisted,
      })
    } catch {
      graphPersisted = false
    }

    const evidenceLineage = auditFullTextLineage(
      evidencePackage,
      analyticalFindings,
      critiqueResult,
      report,
    )

    const durationMs = Date.now() - startedAt
    const llmUsage = snapshotTraceAccounting(accounting)
    const qualityMetrics = computeTraceQualityMetrics({
      evidencePackage,
      analyticalFindings,
      critiqueResult,
      report,
      graph: evidencePackage?.graphEvidence?.[0]
        ? {
            nodes: evidencePackage.graphEvidence[0].nodes || [],
            links: evidencePackage.graphEvidence[0].edges || [],
          }
        : null,
      llmAccounting: llmUsage,
      durationMs,
    })

    const qualityGate = evaluateQualityGate(qualityMetrics, {
      pipelineComplete: true,
      reportPersisted: Boolean(report && report.status === 'ready'),
      graphPersisted,
    })

    if (!qualityGate.passed) {
      const retrievalAudit = buildRetrievalAuditForRun({
        query,
        evidencePackage,
        analyticalFindings,
        report,
      })
      report = await patchReportMetadata(userId, report, {
        status: 'quality_warning',
        generationMetadata: {
          ...(report.generationMetadata || {}),
          qualityGate,
          qualityMetrics,
          qualityStatus: 'failed',
          plannerSearchQueries: plannerSearchQueriesForObservability(plan),
          retrievalObservability: mergeRetrievalObservability(
            evidencePackage,
            retrievalAudit,
          ),
        },
      })

      await activityService.createActivity(userId, {
        sessionId,
        type: RESEARCH_ACTIVITY.FAILED,
        description: `Research quality gate failed: ${qualityGate.failures.join(', ')}`,
        message: 'Research orchestration quality_failed',
        agentId: 'orchestrator',
        metadata: {
          runId: orchestrationRunId,
          agent: 'orchestrator',
          sessionId,
          query,
          queryPreview: query.slice(0, 160),
          success: false,
          status: 'quality_failed',
          durationMs,
          provider: safeMeta.provider,
          model: safeMeta.model,
          llmUsage,
          qualityMetrics,
          qualityGate,
          agentRunIds,
          resumedFrom: workflow.resumedFrom,
          traceProfile: getTraceProfile().name,
        },
        severity: 'warning',
      })

      return {
        runId: orchestrationRunId,
        status: 'quality_failed',
        stage: WORKFLOW_STAGE.COMPLETED,
        workflow,
        report,
        artifacts: {
          researchPlan: plan,
          evidencePackage,
          analyticalFindings,
          critiqueResult,
        },
        meta: withTracePerfMeta(
          {
            startedAt: new Date(startedAt).toISOString(),
            endedAt: new Date().toISOString(),
            durationMs,
            agentRunIds,
            provider: safeMeta.provider,
            model: safeMeta.model,
            llmUsage,
            qualityMetrics,
            qualityGate,
            maxLlmCalls: accounting.maxCalls,
            traceProfile: getTraceProfile().name,
          },
          llmUsage,
        ),
      }
    }

    const retrievalAudit = buildRetrievalAuditForRun({
      query,
      evidencePackage,
      analyticalFindings,
      report,
    })

    report = await patchReportMetadata(userId, report, {
      generationMetadata: {
        ...(report.generationMetadata || {}),
        qualityGate,
        qualityMetrics,
        qualityStatus: 'passed',
        plannerSearchQueries: plannerSearchQueriesForObservability(plan),
        retrievalObservability: mergeRetrievalObservability(
          evidencePackage,
          retrievalAudit,
        ),
      },
    })

    try {
      await researchSessionService.updateSession(userId, sessionId, {
        status: 'COMPLETED',
      })
    } catch {
      // Non-fatal
    }

    stage = WORKFLOW_STAGE.COMPLETED

    await activityService.createActivity(userId, {
      sessionId,
      type: RESEARCH_ACTIVITY.COMPLETED,
      description: 'Research orchestration completed',
      message: 'Research orchestration completed',
      agentId: 'orchestrator',
      metadata: {
        runId: orchestrationRunId,
        agent: 'orchestrator',
        sessionId,
        query,
        queryPreview: query.slice(0, 160),
        success: true,
        durationMs,
        refinementAttempted: workflow.refinement.attempted,
        refinementCount: workflow.refinement.count,
        reportId: String(report._id || report.id || ''),
        reportStatus: report.status,
        agentRunIds,
        provider: safeMeta.provider,
        model: safeMeta.model,
        llmUsage,
        qualityMetrics,
        qualityGate,
        evidenceLineage,
        graphBuild: graphBuildResult
          ? {
              nodeCount: graphBuildResult.stats?.nodeCount,
              linkCount: graphBuildResult.stats?.linkCount,
              graphPersisted,
            }
          : { graphPersisted: false },
        resumedFrom: workflow.resumedFrom,
        traceProfile: getTraceProfile().name,
      },
      payload: {
        workflow,
        llmUsage,
        qualityMetrics,
        qualityGate,
      },
      severity: 'info',
    })

    return {
      runId: orchestrationRunId,
      status: 'completed',
      stage: WORKFLOW_STAGE.COMPLETED,
      workflow,
      report,
      artifacts: {
        researchPlan: plan,
        evidencePackage,
        analyticalFindings,
        critiqueResult,
      },
      meta: withTracePerfMeta(
        {
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date().toISOString(),
          durationMs,
          agentRunIds,
          provider: safeMeta.provider,
          model: safeMeta.model,
          llmUsage,
          qualityMetrics,
          qualityGate,
          maxAgentCalls: {
            planner: 1,
            explorer: workflow.refinement.attempted ? 2 : 1,
            evidenceAnalyst: workflow.refinement.attempted ? 2 : 1,
            critic: workflow.refinement.attempted ? 2 : 1,
            synthesizer: 1,
          },
          maxLlmCalls: accounting.maxCalls,
          traceProfile: getTraceProfile().name,
        },
        llmUsage,
      ),
    }
  } catch (error) {
    if (stage === WORKFLOW_STAGE.PLANNING) workflow.planner = 'failed'
    else if (stage === WORKFLOW_STAGE.EXPLORING) workflow.explorer = 'failed'
    else if (stage === WORKFLOW_STAGE.ANALYZING) {
      workflow.evidenceAnalyst = 'failed'
    } else if (stage === WORKFLOW_STAGE.CRITIQUING) workflow.critic = 'failed'
    else if (stage === WORKFLOW_STAGE.REFINING) {
      workflow.refinement = {
        ...workflow.refinement,
        failed: true,
      }
    } else if (stage === WORKFLOW_STAGE.SYNTHESIZING) {
      workflow.synthesizer = 'failed'
    }

    const orchestratorPipelineFailure =
      stage === WORKFLOW_STAGE.SYNTHESIZING ||
      stage === WORKFLOW_STAGE.REFINING ||
      workflow.synthesizer === 'started' ||
      String(error?.message || '').includes('Invalid synthesizer request') ||
      String(error?.message || '').includes('TRACE lifecycle incomplete')

    if (orchestratorPipelineFailure) {
      evidencePackage = attachOrchestrationFailure(evidencePackage, {
        stage: POST_REFINEMENT_SYNTHESIS_STAGE,
        error: error?.message || String(error || 'Unknown orchestration error'),
        refinementAttempt: workflow.refinement?.count || 0,
        refinementOutcome: workflow.refinement?.completed
          ? 'completed'
          : workflow.refinement?.attempted
            ? 'incomplete'
            : 'skipped',
        synthesizerStarted: workflow.synthesizer === 'started',
        synthesizerCompleted: workflow.synthesizer === 'completed',
        workflowStage: stage,
      })
    }

    const durationMs = Date.now() - startedAt
    const llmUsage = snapshotTraceAccounting(accounting)
    const qualityMetrics = computeTraceQualityMetrics({
      evidencePackage,
      analyticalFindings,
      critiqueResult,
      report,
      llmAccounting: llmUsage,
      durationMs,
    })

    try {
      if (isRateLimitError(error)) {
        const cooldown = getProviderCooldownState()
        const userMessage = formatProviderRateLimitUserMessage({
          cooldownUntil: error?.cooldownUntil ?? cooldown.cooldownUntil,
          rateLimitKind: error?.rateLimitKind || cooldown.rateLimitKind,
        })
        await activityService.createActivity(userId, {
          sessionId,
          type: RESEARCH_ACTIVITY.PROVIDER_RATE_LIMITED,
          description: userMessage,
          message: userMessage,
          agentId: 'orchestrator',
          metadata: {
            runId: orchestrationRunId,
            agent: error?.locallyBlocked
              ? 'orchestrator'
              : stage === WORKFLOW_STAGE.CRITIQUING
                ? 'critic'
                : stage === WORKFLOW_STAGE.SYNTHESIZING
                  ? 'synthesizer'
                  : stage === WORKFLOW_STAGE.ANALYZING
                    ? 'evidence_analyst'
                    : stage === WORKFLOW_STAGE.EXPLORING
                      ? 'explorer'
                      : stage === WORKFLOW_STAGE.PLANNING
                        ? 'planner'
                        : 'orchestrator',
            sessionId,
            queryPreview: query.slice(0, 160),
            success: false,
            stage,
            code: error?.code || 'AI_RATE_LIMIT',
            durationMs,
            provider: safeMeta.provider,
            model: safeMeta.model,
            workflow,
            agentRunIds,
            llmUsage,
            qualityMetrics,
            rateLimitKind: error?.rateLimitKind || cooldown.rateLimitKind || null,
            retryAfterMs: error?.retryAfterMs ?? cooldown.retryAfterMs ?? null,
            cooldownUntil:
              error?.cooldownUntil ?? cooldown.cooldownUntil ?? null,
            providerCircuitOpened: Boolean(llmUsage?.providerCircuitOpened),
            providerCircuitReason: llmUsage?.providerCircuitReason || null,
            locallyBlockedLlmCalls: llmUsage?.locallyBlockedLlmCalls || 0,
            attempts: llmUsage?.totalCalls ?? null,
            retries: llmUsage?.retries ?? null,
            terminal: true,
            locallyBlocked: Boolean(error?.locallyBlocked),
            providerErrorType: error?.providerErrorType || null,
            // Redacted / truncated provider message only
            providerErrorMessage: error?.providerErrorMessage
              ? String(error.providerErrorMessage).slice(0, 240)
              : null,
          },
          severity: 'error',
        })
      } else {
        const agentStageOwnsTerminalActivity = [
          WORKFLOW_STAGE.PLANNING,
          WORKFLOW_STAGE.EXPLORING,
          WORKFLOW_STAGE.ANALYZING,
          WORKFLOW_STAGE.CRITIQUING,
        ].includes(stage)

        if (!agentStageOwnsTerminalActivity || orchestratorPipelineFailure) {
        await activityService.createActivity(userId, {
          sessionId,
          type: RESEARCH_ACTIVITY.FAILED,
          description: error?.message || 'Research orchestration failed',
          message: 'Research orchestration failed',
          agentId: 'orchestrator',
          metadata: {
            runId: orchestrationRunId,
            agent: 'orchestrator',
            sessionId,
            query,
            queryPreview: query.slice(0, 160),
            success: false,
            stage,
            code: error?.code || error?.name || 'AI_ERROR',
            durationMs,
            provider: safeMeta.provider,
            model: safeMeta.model,
            workflow,
            agentRunIds,
            llmUsage,
            qualityMetrics,
            rateLimitKind: error?.rateLimitKind || null,
            providerErrorType: error?.providerErrorType || null,
            providerErrorMessage: error?.providerErrorMessage || null,
            resumedFrom: workflow.resumedFrom,
            orchestrationFailure:
              evidencePackage?.retrievalObservability?.orchestrationFailure ||
              null,
          },
          severity: 'error',
        })
        await persistCheckpoint(userId, {
          sessionId,
          runId: orchestrationRunId,
          query,
          stage: WORKFLOW_STAGE.FAILED,
          workflow,
          plan,
          evidencePackage,
          analyticalFindings,
          critiqueResult,
        })
        }
      }
    } catch {
      // ignore activity failures on error path
    }

    if (isRateLimitError(error)) {
      const cooldown = getProviderCooldownState()
      const userMessage = formatProviderRateLimitUserMessage({
        cooldownUntil: error?.cooldownUntil ?? cooldown.cooldownUntil,
        rateLimitKind: error?.rateLimitKind || cooldown.rateLimitKind,
      })
      error.message = userMessage
    }

    throw error
  }
}

export default {
  runResearch,
  RESEARCH_ACTIVITY,
  WORKFLOW_STAGE,
  MAX_REFINEMENTS,
}
