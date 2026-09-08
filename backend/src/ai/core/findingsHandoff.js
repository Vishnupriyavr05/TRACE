/**
 * @fileoverview Critic ↔ Synthesizer findings handoff contract.
 * Ensures every finding passed to Synthesizer has a Critic evaluation.
 * Does not weaken synthesizer validation — only aligns / asserts the sets.
 */
import { getProfileArtifactLimits } from '../core/traceProfile.js'
import { getCriticContextLimits } from '../agents/critic.context.js'

/**
 * Cap Analyst findings to the shared profile bound so Critic can evaluate all.
 *
 * @param {object} analyticalFindings
 * @param {number} [maxFindings]
 * @returns {{ analyticalFindings: object, bounded: boolean, droppedIds: string[] }}
 */
export function boundAnalyticalFindingsForHandoff(
  analyticalFindings,
  maxFindings = getCriticContextLimits().maxFindings,
) {
  const all = Array.isArray(analyticalFindings?.findings)
    ? analyticalFindings.findings
    : []
  const limit =
    typeof maxFindings === 'number' && maxFindings > 0
      ? Math.floor(maxFindings)
      : getProfileArtifactLimits().maxFindings
  const findings = all.slice(0, limit)
  const droppedIds = all.slice(limit).map((f) => String(f.id))
  return {
    analyticalFindings: {
      ...analyticalFindings,
      findings,
    },
    bounded: droppedIds.length > 0,
    droppedIds,
  }
}

/**
 * Assert Critic evaluations cover every finding handed to Synthesizer.
 * Deterministic failure — does not invent evaluations.
 *
 * @param {object} analyticalFindings
 * @param {object} critiqueResult
 * @returns {{ ok: boolean, errors?: string[], evaluatedIds?: string[] }}
 */
export function assertCritiqueCoversFindings(
  analyticalFindings,
  critiqueResult,
) {
  const findingIds = (analyticalFindings?.findings || []).map((f) =>
    String(f.id),
  )
  const evalIds = new Set(
    (critiqueResult?.findingEvaluations || []).map((e) =>
      String(e.findingId),
    ),
  )
  const missing = findingIds.filter((id) => !evalIds.has(id))
  if (missing.length) {
    return {
      ok: false,
      errors: missing.map(
        (id) => `critiqueResult missing evaluation for findingId "${id}"`,
      ),
      evaluatedIds: [...evalIds],
    }
  }
  return { ok: true, evaluatedIds: findingIds }
}

/**
 * Prepare Analyst findings + Critic result for Synthesizer.
 * Keeps only findings that Critic evaluated (explicit alignment, no fabrication).
 * If Critic evaluated fewer than Analyst produced because of a bound mismatch,
 * findings are restricted to the evaluated set so Synthesizer validation can pass
 * only when the contract is intentional — callers should prefer bounding Analyst
 * before Critic so droppedIds is empty in the happy path.
 *
 * @param {object} analyticalFindings
 * @param {object} critiqueResult
 * @returns {{
 *   ok: boolean,
 *   errors?: string[],
 *   analyticalFindings?: object,
 *   critiqueResult?: object
 * }}
 */
export function prepareFindingsHandoffForSynthesizer(
  analyticalFindings,
  critiqueResult,
) {
  const evalIds = (critiqueResult?.findingEvaluations || []).map((e) =>
    String(e.findingId),
  )
  const evalSet = new Set(evalIds)
  const allFindings = Array.isArray(analyticalFindings?.findings)
    ? analyticalFindings.findings
    : []

  // Unknown evaluations (evals for findings not in Analyst) → hard fail
  const unknown = evalIds.filter(
    (id) => !allFindings.some((f) => String(f.id) === id),
  )
  if (unknown.length) {
    return {
      ok: false,
      errors: unknown.map(
        (id) =>
          `critiqueResult.findingEvaluations references unknown findingId "${id}"`,
      ),
    }
  }

  const covered = allFindings.filter((f) => evalSet.has(String(f.id)))
  const missing = allFindings
    .filter((f) => !evalSet.has(String(f.id)))
    .map((f) => String(f.id))

  // Prefer fail when Critic skipped findings that were in the handoff set
  if (missing.length) {
    return {
      ok: false,
      errors: missing.map(
        (id) => `critiqueResult missing evaluation for findingId "${id}"`,
      ),
    }
  }

  return {
    ok: true,
    analyticalFindings: {
      ...analyticalFindings,
      findings: covered,
    },
    critiqueResult,
  }
}

/**
 * Prepare synthesis handoff; after refinement, deterministically align to the
 * Critic-evaluated finding set when strict handoff fails (never fabricates evals).
 *
 * @param {object} analyticalFindings
 * @param {object} critiqueResult
 * @param {{ allowRepair?: boolean }} [options]
 * @returns {{
 *   ok: boolean,
 *   errors?: string[],
 *   analyticalFindings?: object,
 *   critiqueResult?: object,
 *   repaired?: boolean,
 *   droppedFindingIds?: string[]
 * }}
 */
export function prepareSynthesisHandoffWithRepair(
  analyticalFindings,
  critiqueResult,
  options = {},
) {
  const strict = prepareFindingsHandoffForSynthesizer(
    analyticalFindings,
    critiqueResult,
  )
  if (strict.ok) {
    return { ...strict, repaired: false, droppedFindingIds: [] }
  }

  if (!options.allowRepair) {
    return { ...strict, repaired: false, droppedFindingIds: [] }
  }

  const evalIds = new Set(
    (critiqueResult?.findingEvaluations || []).map((row) =>
      String(row.findingId),
    ),
  )
  const allFindings = Array.isArray(analyticalFindings?.findings)
    ? analyticalFindings.findings
    : []
  const alignedFindings = allFindings.filter((finding) =>
    evalIds.has(String(finding.id)),
  )
  const alignedEvaluations = (critiqueResult?.findingEvaluations || []).filter(
    (row) =>
      alignedFindings.some(
        (finding) => String(finding.id) === String(row.findingId),
      ),
  )

  if (!alignedFindings.length || !alignedEvaluations.length) {
    return { ...strict, repaired: false, droppedFindingIds: [] }
  }

  const repaired = prepareFindingsHandoffForSynthesizer(
    { ...analyticalFindings, findings: alignedFindings },
    { ...critiqueResult, findingEvaluations: alignedEvaluations },
  )
  if (!repaired.ok) {
    return { ...repaired, repaired: false, droppedFindingIds: [] }
  }

  const droppedFindingIds = allFindings
    .filter((finding) => !evalIds.has(String(finding.id)))
    .map((finding) => String(finding.id))

  return {
    ...repaired,
    repaired: true,
    droppedFindingIds,
  }
}

export default {
  boundAnalyticalFindingsForHandoff,
  assertCritiqueCoversFindings,
  prepareFindingsHandoffForSynthesizer,
  prepareSynthesisHandoffWithRepair,
}
