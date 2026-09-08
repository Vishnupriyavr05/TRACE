/**
 * @fileoverview Deterministic orchestrator lifecycle helpers (no agent imports).
 */
import {
  buildEvidenceTargets,
  resolveEvidenceMatrixCoverage,
} from '../core/evidenceTargets.js'
import { extractResearchQueryIntents } from '../core/queryIntents.js'
import { evaluateResearchSufficiency } from '../core/researchSufficiencyGate.js'

export const POST_REFINEMENT_SYNTHESIS_STAGE =
  'POST_REFINEMENT_SYNTHESIS_TRANSITION'

export function closeRefinementGate(workflow = {}) {
  return {
    ...workflow,
    refinement: {
      ...(workflow.refinement || {}),
      gate: 'CLOSED',
      completed: true,
      count: Math.max(1, Number(workflow.refinement?.count) || 1),
      attempted: true,
    },
  }
}

export function buildFinalSynthesisEvidencePackage(
  evidencePackage,
  query,
  analyticalFindings = {},
  recoveryAttempted = false,
) {
  const intents = extractResearchQueryIntents(query)
  const evidenceTargets =
    evidencePackage?.retrievalObservability?.retrievalAudit?.evidenceTargets ||
    buildEvidenceTargets(intents)
  const preliminaryCoverage = resolveEvidenceMatrixCoverage({
    evidencePackage,
    researchQuestion: query,
    analyticalFindings,
    evidenceTargets,
  })

  const researchSufficiency = evaluateResearchSufficiency({
    evidencePackage,
    researchQuestion: query,
    analyticalFindings,
    recoveryAttempted,
    recoveryAllowed: false,
  })

  return {
    ...evidencePackage,
    retrievalObservability: {
      ...(evidencePackage?.retrievalObservability || {}),
      evidenceTargets,
      preliminaryEvidenceTargetCoverage: preliminaryCoverage,
      researchSufficiency: {
        gateVerdict: researchSufficiency.gateVerdict,
        sufficient: researchSufficiency.sufficient,
        shouldRecover: researchSufficiency.shouldRecover,
        recoveryExhausted: researchSufficiency.recoveryExhausted,
        notSearchedCount: researchSufficiency.notSearchedCount,
        corpusSize: researchSufficiency.corpusSize,
        sparseCorpus: researchSufficiency.sparseCorpus,
        searchedRatio: researchSufficiency.searchedRatio,
        usedRatio: researchSufficiency.usedRatio,
        comparisonSufficiency: researchSufficiency.comparisonSufficiency,
      },
    },
  }
}

export function attachOrchestrationFailure(evidencePackage, failure) {
  if (!evidencePackage) return evidencePackage
  return {
    ...evidencePackage,
    retrievalObservability: {
      ...(evidencePackage.retrievalObservability || {}),
      orchestrationFailure: failure,
    },
  }
}

export function assertSynthesisLifecycleComplete(workflow, report, agentRunIds = {}) {
  const errors = []
  if (workflow?.synthesizer !== 'completed') {
    errors.push('synthesizer.completed is not true')
  }
  if (!agentRunIds.synthesizer) {
    errors.push('synthesizer run id missing')
  }
  if (!report || report.status !== 'ready') {
    errors.push('final report missing or not ready')
  }
  return { ok: errors.length === 0, errors }
}