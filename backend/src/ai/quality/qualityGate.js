/**
 * @fileoverview Deterministic TRACE quality gate (no LLM).
 * A 200 LLM response is not success — metrics must pass thresholds.
 */
import { getQualityGateThresholds } from '../core/traceProfile.js'

/**
 * Evaluate quality gate against metrics + pipeline flags.
 *
 * @param {object} metrics - from computeTraceQualityMetrics
 * @param {{
 *   pipelineComplete?: boolean,
 *   reportPersisted?: boolean,
 *   graphPersisted?: boolean,
 *   thresholds?: object
 * }} [options]
 * @returns {{
 *   passed: boolean,
 *   status: 'passed'|'quality_failed',
 *   failures: string[],
 *   thresholds: object,
 *   checks: object
 * }}
 */
export function evaluateQualityGate(metrics = {}, options = {}) {
  const thresholds = {
    ...getQualityGateThresholds(),
    ...(options.thresholds || {}),
  }

  const citationValidity = metrics.citationValidity?.ratio
  const evidenceIdValidity = metrics.evidenceIdValidity?.ratio
  const paperIdValidity = metrics.paperIdValidity?.ratio
  const supportedFindingRate =
    metrics.supportedFindingRate?.ratio ??
    metrics.findingToEvidenceCoverage?.ratio
  const graphOrphanRate = metrics.graphOrphanRate?.rate ?? null
  const duplicateGraphIds =
    (metrics.graphIntegrity?.duplicateNodeIds || 0) +
    (metrics.graphIntegrity?.duplicateEdgeKeys || 0)
  const reportCompleteness = metrics.reportCompleteness?.score
  const unrecoverableProviderFailures =
    metrics.latencyAndErrors?.unrecoverableProviderFailures ??
    metrics.tokenUsage?.unrecoverableProviderFailures ??
    0
  const payloadTooLarge =
    metrics.latencyAndErrors?.count413 ?? metrics.tokenUsage?.count413 ?? 0

  const checks = {
    pipelineComplete: options.pipelineComplete !== false,
    reportPersisted: options.reportPersisted !== false,
    graphPersisted: options.graphPersisted !== false,
    citationValidity:
      citationValidity == null || citationValidity >= thresholds.citationValidityMin,
    evidenceIdValidity:
      evidenceIdValidity == null ||
      evidenceIdValidity >= thresholds.evidenceIdValidityMin,
    paperIdValidity:
      paperIdValidity == null || paperIdValidity >= thresholds.paperIdValidityMin,
    supportedFindingRate:
      supportedFindingRate == null ||
      supportedFindingRate >= thresholds.supportedFindingRateMin,
    graphOrphanRate:
      graphOrphanRate == null || graphOrphanRate <= thresholds.graphOrphanRateMax,
    duplicateGraphIds: duplicateGraphIds <= thresholds.duplicateGraphIdsMax,
    reportCompleteness:
      reportCompleteness == null ||
      reportCompleteness >= thresholds.reportCompletenessMin,
    unrecoverableProviderFailures:
      unrecoverableProviderFailures <= thresholds.providerFailuresMax,
    payloadTooLarge: payloadTooLarge <= thresholds.payloadTooLargeMax,
  }

  const failures = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name)

  const passed = failures.length === 0
  return {
    passed,
    status: passed ? 'passed' : 'quality_failed',
    failures,
    thresholds,
    checks,
  }
}

export default {
  evaluateQualityGate,
}
