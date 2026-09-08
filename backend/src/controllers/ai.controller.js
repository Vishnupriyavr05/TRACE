/**
 * @fileoverview AI HTTP controllers (full individual agent surface).
 */
import * as plannerService from '../ai/agents/planner.service.js'
import * as explorerService from '../ai/agents/explorer.service.js'
import * as evidenceAnalystService from '../ai/agents/evidenceAnalyst.service.js'
import * as criticService from '../ai/agents/critic.service.js'
import * as synthesizerService from '../ai/agents/synthesizer.service.js'
import * as researchOrchestrator from '../ai/orchestrator/researchOrchestrator.service.js'
import { resolveFinalPapers } from '../ai/core/finalEvidenceRegistry.js'
import { AppError } from '../utils/AppError.js'

function getUserId(req) {
  const userId = req.user?._id || req.user?.id
  if (!userId) throw new AppError('Authentication required', 401)
  return String(userId)
}

/**
 * POST /ai/planner
 */
export async function runPlanner(req, res, next) {
  try {
    const result = await plannerService.createResearchPlan(
      getUserId(req),
      req.validated
    )

    res.status(200).json({
      success: true,
      message: 'Research plan created successfully',
      data: {
        runId: result.runId,
        agent: result.agent,
        plan: result.plan,
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /ai/explorer
 */
export async function runExplorer(req, res, next) {
  try {
    const result = await explorerService.exploreResearchPlan(
      getUserId(req),
      req.validated
    )

    const empty =
      result.evidencePackage?.explorationStats?.discoveryAllFailed ||
      result.evidencePackage?.papers?.length === 0

    res.status(200).json({
      success: true,
      message: empty
        ? 'Explorer completed with limited or empty evidence'
        : 'Evidence package created successfully',
      data: {
        runId: result.runId,
        agent: result.agent,
        evidencePackage: result.evidencePackage,
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /ai/evidence-analysis
 */
export async function runEvidenceAnalyst(req, res, next) {
  try {
    const result = await evidenceAnalystService.analyzeEvidencePackage(
      getUserId(req),
      req.validated
    )

    const insufficient = Boolean(result.meta?.insufficientEvidence)

    res.status(200).json({
      success: true,
      message: insufficient
        ? 'Evidence analysis completed with insufficient evidence'
        : 'Evidence analysis completed successfully',
      data: {
        runId: result.runId,
        agent: result.agent,
        analysis: result.analysis,
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /ai/critic
 */
export async function runCritic(req, res, next) {
  try {
    const result = await criticService.critiqueAnalyticalFindings(
      getUserId(req),
      req.validated
    )

    const empty = Boolean(result.meta?.emptyCritique)

    res.status(200).json({
      success: true,
      message: empty
        ? 'Critique completed with insufficient findings/evidence'
        : 'Critique completed successfully',
      data: {
        runId: result.runId,
        agent: result.agent,
        critique: result.critique,
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /ai/synthesize
 */
export async function runSynthesizer(req, res, next) {
  try {
    const result = await synthesizerService.synthesizeResearchReport(
      getUserId(req),
      req.validated
    )

    res.status(200).json({
      success: true,
      message: 'Research report synthesized successfully',
      data: {
        runId: result.runId,
        agent: result.agent,
        report: result.report,
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /ai/research
 */
export async function runResearch(req, res, next) {
  try {
    const result = await researchOrchestrator.runResearch(
      getUserId(req),
      req.validated
    )

    const qualityFailed = result.status === 'quality_failed'

    // Final evidence-backed papers only (discovery corpus kept server-side in artifacts)
    const discoveryPapers = Array.isArray(result.artifacts?.evidencePackage?.papers)
      ? result.artifacts.evidencePackage.papers
      : []
    const papers = resolveFinalPapers(result.report, discoveryPapers)

    res.status(200).json({
      success: true,
      message: qualityFailed
        ? 'Research workflow completed with quality warnings'
        : 'Research workflow completed successfully',
      data: {
        runId: result.runId,
        status: result.status,
        workflow: result.workflow,
        report: result.report,
        papers,
        discoveryPaperCount: discoveryPapers.length,
      },
    })
  } catch (error) {
    next(error)
  }
}
