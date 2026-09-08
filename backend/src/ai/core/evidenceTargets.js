/**
 * @fileoverview Evidence-target matrix for retrieval coverage and audit.
 */
import { NAMED_METHOD_PATTERNS } from '../agents/explorer.methodPatterns.js'
import {
  buildComparativeDiscoveryQuery,
  buildMethodDiscoveryQuery,
  extractResearchQueryIntents,
} from './queryIntents.js'

/**
 * @param {string} value
 * @returns {string}
 */
function slugTarget(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * @param {object} intents
 * @returns {object[]}
 */
export function buildEvidenceTargets(intents) {
  const targets = []

  const dimensions =
    intents.evaluationDimensions?.length > 0
      ? intents.evaluationDimensions
      : ['interpretability']

  for (const method of intents.methods || []) {
    for (const dimension of dimensions) {
      targets.push({
        id: `method:${slugTarget(method)}|dimension:${slugTarget(dimension)}`,
        type: 'method_dimension',
        method,
        dimension,
        domain: intents.domainPhrase || '',
      })
    }
  }

  if (intents.isComparative) {
    targets.push({
      id: 'comparison:multi_method',
      type: 'comparison',
      comparisonType: intents.evidenceTypes?.includes('direct comparison')
        ? 'direct'
        : 'general',
      methods: [...(intents.methods || [])],
      domain: intents.domainPhrase || '',
    })
    if (intents.evidenceTypes?.includes('indirect comparison')) {
      targets.push({
        id: 'comparison:indirect',
        type: 'comparison',
        comparisonType: 'indirect',
        methods: [...(intents.methods || [])],
        domain: intents.domainPhrase || '',
      })
    }
  }

  for (const evidenceType of intents.evidenceTypes || []) {
    if (
      evidenceType === 'clinician studies' ||
      evidenceType === 'reported limitations' ||
      evidenceType === 'standardized evaluation metrics' ||
      evidenceType === 'per-method evidence'
    ) {
      targets.push({
        id: `evidence:${slugTarget(evidenceType)}`,
        type: 'evidence_type',
        evidenceType,
        domain: intents.domainPhrase || '',
        methods: [...(intents.methods || [])],
      })
    }
  }

  return targets
}

/**
 * @param {number} methodIndex
 * @param {string[]} dimensions
 * @returns {string}
 */
function pickDimensionForMethod(methodIndex, dimensions) {
  if (!dimensions.length) return 'interpretability'
  const preferredIndexes = [0, 2, 3, 1]
  for (const idx of preferredIndexes) {
    if (dimensions[idx]) return dimensions[idx]
  }
  return dimensions[methodIndex % dimensions.length]
}

/**
 * @param {object} intents
 * @param {number} maxSlots
 * @param {object[]|string[]} [existingQueries]
 * @returns {object[]}
 */
export function selectDiverseEvidenceTargetQueries(
  intents,
  maxSlots = 4,
  existingQueries = [],
) {
  const slots = Math.max(0, Number(maxSlots) || 0)
  if (!slots || !intents.methods?.length) return []

  const existing = (existingQueries || []).map((row) =>
    typeof row === 'string' ? row : row?.query || '',
  )
  const dimensions =
    intents.evaluationDimensions?.length > 0
      ? intents.evaluationDimensions
      : ['interpretability']
  /** @type {object[]} */
  const queries = []

  const pushQuery = (queryText, meta) => {
    if (!queryText || queries.length >= slots) return
    if (
      existing.some((row) => row.toLowerCase() === queryText.toLowerCase()) ||
      queries.some((row) => row.query.toLowerCase() === queryText.toLowerCase())
    ) {
      return
    }
    queries.push({ query: queryText, methodSpecific: true, ...meta })
  }

  const dimensionPriority = [
    'clinical usefulness',
    'robustness',
    'diagnostic performance',
    'interpretability',
    'standardized evaluation metrics',
  ]
  const orderedDimensions = [
    ...dimensionPriority.filter((dim) =>
      dimensions.some((d) => d.toLowerCase() === dim),
    ),
    ...dimensions.filter(
      (dim) => !dimensionPriority.some((p) => p === dim.toLowerCase()),
    ),
  ]

  /** Interleave method×dimension pairs for matrix coverage (dimension-major). */
  const methodDimensionPairs = []
  for (const dimension of orderedDimensions) {
    for (const method of intents.methods) {
      methodDimensionPairs.push({ method, dimension })
    }
  }

  for (const pair of methodDimensionPairs) {
    if (queries.length >= slots) break
    const targetId = `method:${slugTarget(pair.method)}|dimension:${slugTarget(pair.dimension)}`
    pushQuery(buildMethodDiscoveryQuery(intents, pair.method, pair.dimension), {
      purpose: `Evidence target: ${pair.method} + ${pair.dimension}`,
      evidenceTargetIds: [targetId],
      methodLabel: pair.method,
      evaluationDimension: pair.dimension,
    })
  }

  const comparativeQuery = buildComparativeDiscoveryQuery(intents)
  if (comparativeQuery) {
    pushQuery(comparativeQuery, {
      purpose: 'Comparative multi-method evidence target',
      evidenceTargetIds: ['comparison:multi_method'],
    })
  }

  for (let i = 0; i < intents.methods.length && queries.length < slots; i += 1) {
    const method = intents.methods[i]
    const dimension = pickDimensionForMethod(i, dimensions)
    const targetId = `method:${slugTarget(method)}|dimension:${slugTarget(dimension)}`
    pushQuery(buildMethodDiscoveryQuery(intents, method, dimension), {
      purpose: `Evidence target gap-fill: ${method} + ${dimension}`,
      evidenceTargetIds: [targetId],
      methodLabel: method,
      evaluationDimension: dimension,
    })
  }

  if (
    intents.evidenceTypes?.includes('clinician studies') &&
    queries.length < slots
  ) {
    pushQuery(
      [intents.methods[0], intents.domainPhrase, 'clinician study']
        .filter(Boolean)
        .join(' '),
      {
        purpose: 'Clinician evidence target',
        evidenceTargetIds: ['evidence:clinician_studies'],
      },
    )
  }

  if (
    intents.evidenceTypes?.includes('reported limitations') &&
    queries.length < slots
  ) {
    pushQuery(
      [intents.domainPhrase, 'explainable AI limitations']
        .filter(Boolean)
        .join(' '),
      {
        purpose: 'Limitations evidence target',
        evidenceTargetIds: ['evidence:reported_limitations'],
      },
    )
  }

  return queries.slice(0, slots)
}

/**
 * @param {Map<string, object>} byId
 * @param {object} intents
 */
export function applyEvidenceTargetRankingAdjustments(byId, intents) {
  const targets = buildEvidenceTargets(intents)
  if (!targets.length) return

  for (const entry of byId.values()) {
    const haystack = `${entry.title || ''} ${entry.abstract || ''} ${Array.isArray(entry.keywords) ? entry.keywords.join(' ') : ''}`.toLowerCase()
    let boost = 0

    for (const target of targets) {
      if (target.type === 'method_dimension') {
        const methodPattern = NAMED_METHOD_PATTERNS.find(
          (row) => row.label === target.method,
        )
        const methodHit = methodPattern?.pattern.test(haystack)
        const dimHit = haystack.includes(String(target.dimension).toLowerCase())
        if (methodHit && dimHit) boost += 0.12
        else if (methodHit) boost += 0.06
        else if (dimHit && intents.methods.length) boost += 0.03
      }
      if (target.type === 'comparison' && /\b(compare|comparison|versus|vs\.?)\b/i.test(haystack)) {
        boost += 0.05
      }
      if (
        target.type === 'evidence_type' &&
        target.evidenceType === 'clinician studies' &&
        /\bclinician|clinical evaluation|reader study\b/i.test(haystack)
      ) {
        boost += 0.05
      }
    }

    const isGenericSurvey =
      /\b(systematic review|literature review|survey)\b/i.test(haystack) &&
      !intents.methods.some((method) => haystack.includes(method.toLowerCase().split('-')[0]))
    if (isGenericSurvey && intents.methods.length >= 2) {
      boost -= 0.08
      entry.surveyDampened = true
    }

    if (boost !== 0) {
      const current = typeof entry.relevance === 'number' ? entry.relevance : 0
      entry.relevance = Number(Math.min(1, Math.max(0, current + boost)).toFixed(4))
    }
  }
}

/**
 * @param {object[]} sortedPapers
 * @param {object} intents
 * @param {number} maxKeep
 * @returns {Set<string>}
 */
export function buildCapKeepSet(sortedPapers, intents, maxKeep) {
  const keep = new Set(
    sortedPapers.slice(0, maxKeep).map((paper) => String(paper.paperId)),
  )
  if (!intents.methods?.length) return keep

  for (const methodLabel of intents.methods) {
    const methodPattern = NAMED_METHOD_PATTERNS.find(
      (row) => row.label === methodLabel,
    )
    if (!methodPattern) continue

    const hasMethod = [...keep].some((paperId) => {
      const paper = sortedPapers.find((row) => String(row.paperId) === paperId)
      if (!paper) return false
      const haystack = `${paper.title || ''} ${paper.abstract || ''}`
      return methodPattern.pattern.test(haystack)
    })
    if (hasMethod) continue

    const candidate = sortedPapers.find((paper) => {
      if (keep.has(String(paper.paperId))) return false
      const haystack = `${paper.title || ''} ${paper.abstract || ''}`
      return methodPattern.pattern.test(haystack)
    })
    if (!candidate) continue

    const keepList = sortedPapers.filter((paper) => keep.has(String(paper.paperId)))
    const weakest = keepList[keepList.length - 1]
    if (!weakest) continue
    if ((candidate.relevance || 0) >= (weakest.relevance || 0) - 0.12) {
      keep.delete(String(weakest.paperId))
      keep.add(String(candidate.paperId))
    }
  }

  return keep
}

/**
 * @param {object} target
 * @param {string} haystack
 * @returns {boolean}
 */
function targetMatchesPaper(target, haystack) {
  const text = String(haystack || '').toLowerCase()
  if (target.type === 'method_dimension') {
    const methodPattern = NAMED_METHOD_PATTERNS.find(
      (row) => row.label === target.method,
    )
    return (
      Boolean(methodPattern?.pattern.test(text)) &&
      text.includes(String(target.dimension).toLowerCase())
    )
  }
  if (target.type === 'comparison') {
    const methodHits = (target.methods || []).filter((method) =>
      text.includes(String(method).toLowerCase()),
    ).length
    return methodHits >= 2 || /\b(compare|comparison|versus|vs\.?)\b/i.test(text)
  }
  if (target.type === 'evidence_type') {
    if (target.evidenceType === 'clinician studies') {
      return /\bclinician|clinical evaluation|reader study\b/i.test(text)
    }
    if (target.evidenceType === 'reported limitations') {
      return /\blimitations?\b/i.test(text)
    }
    if (target.evidenceType === 'standardized evaluation metrics') {
      return /\b(metrics?|auc|f1|accuracy|sensitivity|specificity)\b/i.test(text)
    }
  }
  return false
}

/**
 * @param {object} input
 * @returns {object}
 */
export function computeEvidenceTargetCoverage(input = {}) {
  const targets = input.evidenceTargets || []
  const executed = input.executedQueries || []
  const corpusPapers = input.corpusPapers || []
  const paperEvidenceLevels = input.paperEvidenceLevels || {}
  const extractedEvidenceItems = input.extractedEvidenceItems || []
  const registryPaperIds = new Set(
    (input.registryPaperIds || []).map((id) => String(id)),
  )
  const findingPaperIds = new Set(
    (input.findingPaperIds || []).map((id) => String(id)),
  )

  const searchedTargetIds = new Set()
  /** @type {Map<string, number>} */
  const queriesExecutedByTarget = new Map()
  for (const row of executed) {
    for (const targetId of row.evidenceTargetIds || []) {
      const id = String(targetId)
      searchedTargetIds.add(id)
      queriesExecutedByTarget.set(
        id,
        (queriesExecutedByTarget.get(id) || 0) + 1,
      )
    }
    const query = String(row.query || '').toLowerCase()
    for (const target of targets) {
      if (target.type === 'method_dimension') {
        if (
          query.includes(String(target.method).toLowerCase()) &&
          query.includes(String(target.dimension).toLowerCase())
        ) {
          searchedTargetIds.add(target.id)
          queriesExecutedByTarget.set(
            target.id,
            (queriesExecutedByTarget.get(target.id) || 0) + 1,
          )
        }
      }
    }
  }

  /** @type {object[]} */
  const rows = []
  for (const target of targets) {
    const relevantPaperIds = []
    const fullTextPaperIds = []
    const citedPaperIds = []
    const registryHits = []
    const assessedPaperIds = []

    for (const paper of corpusPapers) {
      const paperId = String(paper.paperId)
      const haystack = `${paper.title || ''} ${paper.abstract || ''}`
      if (!targetMatchesPaper(target, haystack)) continue
      relevantPaperIds.push(paperId)
      if (paperEvidenceLevels[paperId] === 'FULL_TEXT') {
        fullTextPaperIds.push(paperId)
      }
      if (findingPaperIds.has(paperId)) citedPaperIds.push(paperId)
      if (registryPaperIds.has(paperId)) registryHits.push(paperId)
    }

    for (const item of extractedEvidenceItems) {
      const paperId = String(item.paperId || '')
      if (!relevantPaperIds.includes(paperId)) continue
      if (!assessedPaperIds.includes(paperId)) assessedPaperIds.push(paperId)
    }

    const relevantItemText = (item) => {
      const paperId = String(item.paperId || '')
      return relevantPaperIds.includes(paperId)
        ? String(item.text || item.abstract || '')
        : ''
    }

    const quantitativeEvidence = extractedEvidenceItems.some((item) =>
      /\b(accuracy|auc|sensitivity|specificity|f1|performance|metric|score)\b/i.test(
        relevantItemText(item),
      ),
    )
    const clinicalEvidence = extractedEvidenceItems.some((item) =>
      /\b(clinician|clinical evaluation|reader study|physician|radiologist|usability|workflow)\b/i.test(
        relevantItemText(item),
      ),
    )
    const robustnessEvidence = extractedEvidenceItems.some((item) =>
      /\b(robust|robustness|adversarial|perturbation|stability|generaliz)\b/i.test(
        relevantItemText(item),
      ),
    )
    const comparativeEvidence =
      target.type === 'comparison' ||
      extractedEvidenceItems.some((item) =>
        /\b(compare|comparison|versus|vs\.?|head-to-head|outperform)\b/i.test(
          relevantItemText(item),
        ),
      ) ||
      corpusPapers.some((paper) => {
        const paperId = String(paper.paperId)
        if (!relevantPaperIds.includes(paperId)) return false
        const haystack = `${paper.title || ''} ${paper.abstract || ''}`
        return /\b(compare|comparison|versus|vs\.?)\b/i.test(haystack)
      })

    rows.push({
      targetId: target.id,
      type: target.type,
      method: target.method || null,
      dimension: target.dimension || null,
      evidenceType: target.evidenceType || null,
      searched: searchedTargetIds.has(target.id),
      queriesExecutedCount: queriesExecutedByTarget.get(target.id) || 0,
      relevantPaperCount: relevantPaperIds.length,
      fullTextPaperCount: fullTextPaperIds.length,
      assessedPaperCount: assessedPaperIds.length,
      citedPaperCount: citedPaperIds.length,
      registryPaperCount: registryHits.length,
      hasQuantitativeEvidence: quantitativeEvidence,
      hasClinicalEvidence: clinicalEvidence,
      hasRobustnessEvidence: robustnessEvidence,
      hasComparativeEvidence: comparativeEvidence,
      status:
        registryHits.length > 0
          ? 'supported_in_final_registry'
          : fullTextPaperIds.length > 0
            ? 'full_text_available'
            : relevantPaperIds.length > 0
              ? 'relevant_papers_found'
              : searchedTargetIds.has(target.id)
                ? 'searched_no_relevant_papers'
                : 'not_searched',
    })
  }

  return {
    targetCount: targets.length,
    searchedCount: rows.filter((row) => row.searched).length,
    relevantCount: rows.filter((row) => row.relevantPaperCount > 0).length,
    fullTextCount: rows.filter((row) => row.fullTextPaperCount > 0).length,
    registryCount: rows.filter((row) => row.registryPaperCount > 0).length,
    rows,
  }
}

/**
 * @param {object} input
 * @returns {object}
 */
/**
 * @param {object} row
 * @returns {string}
 */
export function formatEvidenceTargetLabel(row) {
  if (row.method && row.dimension) {
    return [row.method, row.dimension].filter(Boolean).join(' + ')
  }
  if (row.evidenceType) return String(row.evidenceType)
  if (row.type === 'comparison') return 'comparative evidence'
  return String(row.targetId || 'requested evidence target')
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isGenericEvidenceGapPhrase(text) {
  const value = String(text || '').trim()
  if (!value) return true
  return (
    /\binsufficient evidence\b/i.test(value) &&
    !/\bsearched\b|\bretrieved\b|\bfull[- ]text\b|\babstract\b|\btarget\b/i.test(
      value,
    )
  )
}

/**
 * @param {object|null|undefined} coverage
 * @param {{ maxItems?: number }} [options]
 * @returns {string[]}
 */
export {
  formatEvidenceTargetGapDescriptions,
  auditFindingReferenceConsistency,
  auditFindingEvidenceChain,
} from './evidenceChain.js'

/**
 * @param {object} input
 * @returns {object}
 */
export function resolveEvidenceMatrixCoverage(input = {}) {
  const evidencePackage = input.evidencePackage || {}
  const query =
    input.researchQuestion ||
    evidencePackage.researchQuestion ||
    evidencePackage?.retrievalObservability?.retrievalAudit?.userQuery ||
    ''
  const intents = extractResearchQueryIntents(query)
  const evidenceTargets =
    input.evidenceTargets ||
    evidencePackage?.retrievalObservability?.retrievalAudit?.evidenceTargets ||
    evidencePackage?.retrievalObservability?.evidenceTargets ||
    buildEvidenceTargets(intents)
  const executedQueries =
    evidencePackage?.retrievalObservability?.retrievalAudit?.plannerQueryCoverage
      ?.executed ||
    evidencePackage?.retrievalObservability?.retrievalAudit?.plannerQueries
      ?.executed ||
    []

  /** @type {string[]} */
  const findingPaperIds = []
  for (const finding of input.analyticalFindings?.findings || input.findings || []) {
    for (const paperId of finding.paperIds || []) {
      findingPaperIds.push(String(paperId))
    }
  }

  return computeEvidenceTargetCoverage({
    evidenceTargets,
    executedQueries,
    corpusPapers: evidencePackage.papers || [],
    paperEvidenceLevels: evidencePackage.paperEvidenceLevels || {},
    extractedEvidenceItems: evidencePackage.extractedEvidenceItems || [],
    findingPaperIds,
    registryPaperIds: input.registryPaperIds || [],
  })
}

/**
 * @param {object|null|undefined} critiqueResult
 * @param {object} [context]
 * @returns {string[]}
 */
export function resolveContradictionStatements(critiqueResult, context = {}) {
  const criticRows = (critiqueResult?.contradictions || [])
    .map((row) =>
      typeof row === 'string' ? row : row?.description || row?.statement || '',
    )
    .map((row) => String(row).trim())
    .filter(Boolean)
  if (criticRows.length) return criticRows

  const sufficiency =
    critiqueResult?.overallAssessment?.evidenceSufficiency || 'INSUFFICIENT'
  const relevantCount = Number(context.relevantCount || 0)
  const findingCount = Number(context.findingCount || 0)

  if (
    sufficiency === 'INSUFFICIENT' ||
    (relevantCount === 0 && findingCount === 0)
  ) {
    return [
      'Contradiction assessment was limited because the retrieved evidence was insufficient for meaningful comparison.',
    ]
  }

  return ['No contradictions identified among the evidence assessed.']
}

export default {
  buildEvidenceTargets,
  selectDiverseEvidenceTargetQueries,
  applyEvidenceTargetRankingAdjustments,
  buildCapKeepSet,
  computeEvidenceTargetCoverage,
  formatEvidenceTargetLabel,
  isGenericEvidenceGapPhrase,
  resolveEvidenceMatrixCoverage,
  resolveContradictionStatements,
}
