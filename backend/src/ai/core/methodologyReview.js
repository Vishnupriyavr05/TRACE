/**
 * @fileoverview Derive methodology strengths/weaknesses from retrieved evidence and observability.
 */

const LIMITATION_RE =
  /\b(challenge|challenges|limitation|limitations|drawback|drawbacks|weakness|weaknesses|requires|requirement|however|although|cannot|inflexible|constraint|constraints|problem|difficult|difficulty|barrier|trade-?off|tradeoff|degradation|shortcoming|must adapt)\b/i

const METHOD_DESC_RE =
  /\b(method|algorithm|technique|approach|architecture|mapping|propagat|layer|network|visualiz|mechanism|gradient|activation|pooling|convolutional|proposed|capable|obtain|compute|distinguish|procedure|optimization)\b/i

/**
 * @param {string} text
 * @returns {'strength'|'weakness'|null}
 */
export function classifyMethodologyEvidence(text) {
  const value = String(text || '').trim()
  if (value.length < 24) return null
  const hasLimit = LIMITATION_RE.test(value)
  const hasMethod = METHOD_DESC_RE.test(value)
  if (hasLimit) return 'weakness'
  if (hasMethod) return 'strength'
  return null
}

/**
 * @param {object[]} items
 * @returns {{ strengths: string[], weaknesses: string[], limitations: string }}
 */
export function buildMethodologyReviewFromEvidenceItems(items = []) {
  const strengths = []
  const weaknesses = []
  const seen = new Set()

  for (const item of items || []) {
    const text = String(item?.text || '').trim()
    if (!text) continue
    const level = String(item?.evidenceLevel || '').toUpperCase()
    const isFullText =
      level === 'FULL_TEXT' || String(item?.sourceType || '') === 'full_text'
    if (!isFullText) continue

    const kind = classifyMethodologyEvidence(text)
    if (!kind) continue

    const excerpt = text.length > 320 ? `${text.slice(0, 317)}...` : text
    if (seen.has(excerpt)) continue
    seen.add(excerpt)

    if (kind === 'weakness') weaknesses.push(excerpt)
    else strengths.push(excerpt)
  }

  return {
    strengths,
    weaknesses,
    limitations:
      strengths.length + weaknesses.length
        ? 'Assessment derived from available full-text methodological evidence only; it does not establish comparative coverage across all requested methodological categories.'
        : '',
  }
}

/**
 * @param {object|null|undefined} retrievalObservability
 * @returns {{ strengths: string[], weaknesses: string[], limitations: string }}
 */
export function buildMethodologyReviewFromObservability(
  retrievalObservability = {},
) {
  const audit = retrievalObservability?.retrievalAudit || {}
  const coverage =
    audit.evidenceTargetCoverage ||
    retrievalObservability?.preliminaryEvidenceTargetCoverage ||
    {}
  const executed =
    audit.plannerQueryCoverage?.executed ||
    audit.plannerQueries?.executed ||
    []
  const sufficiency = retrievalObservability?.researchSufficiency || {}
  const rows = coverage.rows || []

  /** @type {string[]} */
  const strengths = []
  /** @type {string[]} */
  const weaknesses = []

  if (executed.length > 0) {
    const targetLinked = executed.filter(
      (row) => (row.evidenceTargetIds || []).length > 0,
    ).length
    strengths.push(
      `Executed ${executed.length} retrieval quer${executed.length === 1 ? 'y' : 'ies'} for this run${targetLinked ? `, including ${targetLinked} query/queries explicitly mapped to evidence-matrix targets` : ''}.`,
    )
  }

  if (coverage.relevantCount > 0) {
    strengths.push(
      `Discovered relevant papers for ${coverage.relevantCount} of ${coverage.targetCount || rows.length} requested evidence target(s).`,
    )
  }

  if (coverage.fullTextCount > 0) {
    strengths.push(
      `Full-text material was available for ${coverage.fullTextCount} target(s), supporting deeper assessment beyond abstract-only discovery.`,
    )
  }

  const abstractOnly = rows.filter(
    (row) =>
      (row.relevantPaperCount || 0) > 0 && (row.fullTextPaperCount || 0) === 0,
  ).length
  if (abstractOnly > 0) {
    strengths.push(
      `${abstractOnly} target(s) retained abstract-only relevant papers that remain counted in discovery accounting even when full-text acquisition did not succeed.`,
    )
  }

  if (coverage.notSearchedCount > 0) {
    weaknesses.push(
      `${coverage.notSearchedCount} evidence target(s) were not searched within the configured retrieval budget; TRACE cannot infer scientific absence for those targets.`,
    )
  }

  const searchedNoRelevant = rows.filter(
    (row) =>
      row.status === 'searched_no_relevant_papers' ||
      row.state === 'SEARCHED_NO_RELEVANT_RESULTS',
  ).length
  if (searchedNoRelevant > 0) {
    weaknesses.push(
      `${searchedNoRelevant} searched target(s) returned no relevant papers in the retained corpus.`,
    )
  }

  if (sufficiency.sparseCorpus) {
    weaknesses.push(
      `The retained corpus (${sufficiency.corpusSize || audit.corpusPaperCount || '?'} papers) is sparse relative to the comparative scope of the question.`,
    )
  }

  if (sufficiency.comparisonSufficiency?.indirectComparisonOnly) {
    weaknesses.push(
      'Comparative conclusions in this run rely on indirect cross-study evidence rather than direct head-to-head comparisons.',
    )
  }

  const limitations =
  strengths.length || weaknesses.length
    ? 'This methodology review describes TRACE retrieval and assessment process for this run. It distinguishes what was searched, discovered, fully assessed, and used — not definitive claims about literature absence.'
    : 'Limited retrieval observability was recorded for this run; process strengths and weaknesses could not be fully characterized.'

  return {
    strengths: strengths.length
      ? strengths
      : [
          'Evidence-matrix retrieval planning was applied to decompose the natural-language research question into method, dimension, and comparison targets.',
        ],
    weaknesses: weaknesses.length
      ? weaknesses
      : [
          'No major process weaknesses beyond normal bounded-search constraints were recorded in observability data.',
        ],
    limitations,
  }
}

/**
 * @param {object|null|undefined} registry
 * @param {string} [paperId]
 * @param {object|null|undefined} [retrievalObservability]
 * @returns {{ strengths: string[], weaknesses: string[], limitations: string }}
 */
export function buildMethodologyReviewFromRegistry(
  registry,
  paperId = '',
  retrievalObservability = null,
) {
  const items = (registry?.evidenceItems || []).filter((item) => {
    if (!paperId) return true
    return String(item.paperId) === String(paperId)
  })
  const fromEvidence = buildMethodologyReviewFromEvidenceItems(items)
  const fromObservability = retrievalObservability
    ? buildMethodologyReviewFromObservability(retrievalObservability)
    : null

  if (fromObservability) {
    return fromObservability
  }

  return {
    strengths: fromEvidence.strengths.length
      ? fromEvidence.strengths
      : [
          'Full-text methodological excerpts were limited in the final evidence registry for this run.',
        ],
    weaknesses: fromEvidence.weaknesses.length
      ? fromEvidence.weaknesses
      : [
          'Methodological weaknesses could not be grounded in full-text excerpts because few or none were available.',
        ],
    limitations:
      fromEvidence.limitations ||
      'Methodology assessment was limited by available full-text evidence in the final registry.',
  }
}

export default {
  classifyMethodologyEvidence,
  buildMethodologyReviewFromEvidenceItems,
  buildMethodologyReviewFromObservability,
  buildMethodologyReviewFromRegistry,
}
