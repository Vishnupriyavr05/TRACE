/**
 * @fileoverview Bounded Synthesizer context — Critic-approved findings + papers only.
 * Does not dump full EvidencePackage / AnalyticalFindings into the LLM prompt.
 * GraphRAG topology is omitted from the LLM context (not required for report assembly).
 */
import {
  SYNTHESIZER_MAX_FINDINGS,
  SYNTHESIZER_MAX_PAPERS,
  SYNTHESIZER_MAX_ABSTRACT_CHARS,
  SYNTHESIZER_MAX_CONTRADICTIONS,
  SYNTHESIZER_MAX_GAPS,
  SYNTHESIZER_MAX_COVERAGE,
} from '../../config/environment/env.js'
import {
  partitionFindingsByCritic,
  buildCitation,
} from '../validators/synthesizer.schema.js'
import {
  envNumber,
  getProfileArtifactLimits,
} from '../core/traceProfile.js'
import {
  buildPackageEvidenceIndexes,
  getExtractedEvidenceItems,
} from '../core/evidencePackageIndexes.js'
import { buildEvidenceChainGapAnalysis } from '../core/evidenceChain.js'
import { resolveEvidenceMatrixCoverage } from '../core/evidenceTargets.js'
import { normalizeEvidenceLevel } from '../core/evidenceLevels.js'
import {
  computeComparisonSufficiency,
  evaluateResearchSufficiency,
} from '../core/researchSufficiencyGate.js'
import { extractResearchQueryIntents } from '../core/queryIntents.js'

/**
 * @returns {{
 *   maxFindings: number,
 *   maxPapers: number,
 *   maxAbstractChars: number,
 *   maxContradictions: number,
 *   maxGaps: number,
 *   maxCoverage: number
 * }}
 */
export function getSynthesizerContextLimits() {
  const profile = getProfileArtifactLimits()
  return {
    maxFindings: envNumber(
      'SYNTHESIZER_MAX_FINDINGS',
      profile.maxFindings || SYNTHESIZER_MAX_FINDINGS,
    ),
    maxPapers: envNumber(
      'SYNTHESIZER_MAX_PAPERS',
      profile.maxPapers || SYNTHESIZER_MAX_PAPERS,
    ),
    maxAbstractChars: envNumber(
      'SYNTHESIZER_MAX_ABSTRACT_CHARS',
      profile.maxAbstractChars || SYNTHESIZER_MAX_ABSTRACT_CHARS,
    ),
    maxContradictions: envNumber(
      'SYNTHESIZER_MAX_CONTRADICTIONS',
      profile.maxContradictions || SYNTHESIZER_MAX_CONTRADICTIONS,
    ),
    maxGaps: envNumber(
      'SYNTHESIZER_MAX_GAPS',
      profile.maxGaps || SYNTHESIZER_MAX_GAPS,
    ),
    maxCoverage: envNumber(
      'SYNTHESIZER_MAX_COVERAGE',
      SYNTHESIZER_MAX_COVERAGE,
    ),
  }
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

/**
 * @param {unknown[]} requirements
 * @param {number} max
 * @returns {string[]}
 */
function compactRequirements(requirements, max) {
  return (Array.isArray(requirements) ? requirements : [])
    .slice(0, max)
    .map((item) => {
      if (typeof item === 'string') return truncate(item, 140)
      if (item && typeof item === 'object') {
        return truncate(
          item.description ||
            item.requirement ||
            item.text ||
            String(item.id || ''),
          140,
        )
      }
      return ''
    })
    .filter(Boolean)
}

/**
 * Safe payload-size diagnostics (no prompts/secrets).
 *
 * @param {object} context
 * @param {object} [extra]
 */
export function measureSynthesizerPayload(context, extra = {}) {
  const serialized = JSON.stringify(context || {})
  const serializedChars = serialized.length
  const findings = context?.criticDecisions?.includableFindings || []
  const excluded = context?.criticDecisions?.excludedFindings || []
  return {
    findings: findings.length,
    excludedFindings: excluded.length,
    papers: Array.isArray(context?.evidenceItems)
      ? context.evidenceItems.length
      : 0,
    evidenceItems: Array.isArray(context?.evidenceItems)
      ? context.evidenceItems.length
      : 0,
    critiqueEvaluations: findings.length,
    contradictions: Array.isArray(context?.contradictions)
      ? context.contradictions.length
      : 0,
    gaps: Array.isArray(context?.gaps) ? context.gaps.length : 0,
    coverage: Array.isArray(context?.evidenceCoverage)
      ? context.evidenceCoverage.length
      : 0,
    references: Array.isArray(context?.evidenceItems)
      ? context.evidenceItems.length
      : 0,
    graphNodes: 0,
    graphEdges: 0,
    graphPaths: 0,
    serializedChars,
    estimatedTokens: Math.ceil(serializedChars / 4),
    ...extra,
  }
}

/**
 * Build bounded synthesis context. Critic decisions are first-class.
 * Paper metadata appears once in evidenceItems; findings carry IDs only.
 *
 * @param {{
 *   researchPlan: object,
 *   evidencePackage: object,
 *   analyticalFindings: object,
 *   critiqueResult: object,
 *   researchQuestion: string
 * }} args
 * @param {object} [limits]
 */
export function buildSynthesizerContext(
  args,
  limits = getSynthesizerContextLimits(),
) {
  const {
    researchPlan,
    evidencePackage,
    analyticalFindings,
    critiqueResult,
    researchQuestion,
  } = args

  const partition = partitionFindingsByCritic(
    analyticalFindings,
    critiqueResult,
  )
  const matrixCoverage = resolveEvidenceMatrixCoverage({
    evidencePackage,
    researchQuestion,
    analyticalFindings,
  })
  const evidenceChain = buildEvidenceChainGapAnalysis(
    matrixCoverage,
    (critiqueResult.gaps || []).map((g) => g.description).filter(Boolean),
  )
  const obsSufficiency =
    evidencePackage?.retrievalObservability?.researchSufficiency || null
  const evaluatedSufficiency = evaluateResearchSufficiency({
    evidencePackage,
    researchQuestion,
    analyticalFindings,
    recoveryAttempted: true,
    recoveryAllowed: false,
  })
  const researchSufficiency = obsSufficiency
    ? {
        ...evaluatedSufficiency,
        ...obsSufficiency,
        comparisonSufficiency:
          obsSufficiency.comparisonSufficiency ||
          evaluatedSufficiency.comparisonSufficiency,
      }
    : evaluatedSufficiency
  const comparisonSufficiency =
    researchSufficiency.comparisonSufficiency ||
    computeComparisonSufficiency(
      matrixCoverage,
      extractResearchQueryIntents(researchQuestion),
    )

  const includable = partition.includable.slice(0, limits.maxFindings)
  const findingsBounded = includable.length < partition.includable.length

  /** @type {Set<string>} */
  const allowedFindingIds = new Set(includable.map((f) => String(f.id)))
  /** @type {Set<string>} */
  const excludedFindingIds = new Set(
    partition.excluded.map((f) => String(f.id)),
  )
  /** @type {Set<string>} */
  const qualifyFindingIds = new Set(
    partition.byHandling.QUALIFY.map((f) => String(f.id)),
  )
  /** @type {Map<string, string>} */
  const criticConfidenceByFinding = new Map(
    (critiqueResult.findingEvaluations || []).map((e) => [
      String(e.findingId),
      e.confidence || 'LOW',
    ]),
  )

  // Full paper map retained for validator / citation grounding (not dumped to LLM)
  const papersById = new Map(
    (evidencePackage.papers || []).map((p) => [String(p.paperId), p]),
  )

  /** @type {Set<string>} */
  const citedPaperIds = new Set()
  for (const finding of includable) {
    for (const pid of finding.paperIds || []) citedPaperIds.add(String(pid))
    for (const pid of finding.critic?.paperIds || []) {
      citedPaperIds.add(String(pid))
    }
  }

  const citedPapers = [...citedPaperIds]
    .map((id) => papersById.get(id))
    .filter(Boolean)
    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))

  const remaining = (evidencePackage.papers || [])
    .filter((p) => !citedPaperIds.has(String(p.paperId)))
    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))

  const selectedPapers = [...citedPapers, ...remaining].slice(
    0,
    limits.maxPapers,
  )
  const papersBounded =
    selectedPapers.length < (evidencePackage.papers || []).length

  /** @type {Map<string, string>} */
  const evidenceIdToPaperId = new Map()
  /** @type {Set<string>} */
  const allowedPaperIds = new Set()
  /** @type {Set<string>} */
  const allowedEvidenceIds = new Set()

  const hasExtracted = getExtractedEvidenceItems(evidencePackage).length > 0
  /** @type {object[]} */
  let evidenceItems
  if (hasExtracted) {
    const indexed = buildPackageEvidenceIndexes(evidencePackage, {
      maxPapers: limits.maxPapers,
    })
    const selectedIds = new Set(selectedPapers.map((p) => String(p.paperId)))
    evidenceItems = indexed.evidenceItems
      .filter((item) => selectedIds.has(String(item.paperId)))
      .map((item) => ({
        ...item,
        evidenceLevel: normalizeEvidenceLevel(
          item.evidenceLevel ||
            evidencePackage.paperEvidenceLevels?.[String(item.paperId)] ||
            'ABSTRACT',
        ),
        title: truncate(item.title || papersById.get(String(item.paperId))?.title || '', 160),
        abstract: truncate(
          item.abstract ||
            item.text ||
            papersById.get(String(item.paperId))?.abstract ||
            '',
          limits.maxAbstractChars,
        ),
        text: truncate(item.text || '', limits.maxAbstractChars * 2),
        citation: truncate(
          buildCitation(papersById.get(String(item.paperId)) || {}),
          220,
        ),
      }))
    for (const [k, v] of indexed.evidenceIdToPaperId) {
      evidenceIdToPaperId.set(k, v)
      allowedEvidenceIds.add(String(k))
    }
    for (const pid of selectedIds) allowedPaperIds.add(String(pid))
  } else {
    evidenceItems = selectedPapers.map((paper, index) => {
      const evidenceId = `EV${index + 1}`
      const paperId = String(paper.paperId)
      evidenceIdToPaperId.set(evidenceId, paperId)
      allowedEvidenceIds.add(evidenceId)
      allowedPaperIds.add(paperId)
      return {
        evidenceId,
        paperId,
        evidenceLevel: normalizeEvidenceLevel(
          evidencePackage.paperEvidenceLevels?.[paperId] || 'ABSTRACT',
        ),
        title: truncate(paper.title || '', 160),
        abstract: truncate(paper.abstract || '', limits.maxAbstractChars),
        year: paper.year ?? null,
        venue: truncate(paper.venue || '', 60),
        source: paper.source || null,
        providers: (paper.provenance?.providers || []).slice(0, 3),
        citation: truncate(buildCitation(paper), 220),
        relevance: typeof paper.relevance === 'number' ? paper.relevance : null,
        nodeId: paper.provenance?.nodeId || null,
      }
    })
  }

  const paperIdToEvidenceId = new Map()
  if (!hasExtracted) {
    for (const item of evidenceItems) {
      paperIdToEvidenceId.set(item.paperId, item.evidenceId)
    }
  }

  const findingsForPrompt = includable.map((finding) => {
    const paperIds = (finding.paperIds || [])
      .map(String)
      .filter((id) => allowedPaperIds.has(id))
    const evidenceIds = hasExtracted
      ? (finding.evidenceIds || [])
          .map(String)
          .filter((id) => allowedEvidenceIds.has(id))
      : [
          ...new Set(
            paperIds.map((pid) => paperIdToEvidenceId.get(pid)).filter(Boolean),
          ),
        ]
    const handling = finding.critic?.recommendedHandling || 'QUALIFY'
    const safer = truncate(finding.critic?.saferInterpretation || '', 240)
    const original = truncate(finding.statement || '', 280)
    const statement =
      handling === 'QUALIFY' && safer ? safer : original

    return {
      id: finding.id,
      statement,
      ...(safer && safer !== statement
        ? { saferInterpretation: safer }
        : {}),
      ...(original !== statement
        ? { originalStatement: original }
        : {}),
      type: finding.type,
      handling,
      criticSupport: finding.critic?.support,
      confidenceCeiling: finding.critic?.confidence || 'LOW',
      issues: (finding.critic?.issues || [])
        .slice(0, 2)
        .map((issue) => truncate(String(issue), 80)),
      evidenceAssessment: truncate(
        finding.critic?.evidenceAssessment || '',
        120,
      ),
      paperIds,
      evidenceIds,
      rule:
        handling === 'QUALIFY'
          ? 'Must use cautious/qualified wording.'
          : 'May represent as a supported conclusion at or below confidenceCeiling.',
    }
  })

  const excludedForPrompt = partition.excluded.slice(0, 8).map((f) => ({
    id: f.id,
    statement: truncate(f.statement || '', 160),
    support: f.critic?.support || null,
    handling: 'EXCLUDE',
    note: 'Must NOT appear as a factual conclusion',
  }))

  const overall = critiqueResult.overallAssessment || {}
  const context = {
    researchQuestion: truncate(researchQuestion || '', 280),
    objective: truncate(researchPlan?.objective || '', 220),
    researchDimensions: (researchPlan?.researchDimensions || [])
      .slice(0, 6)
      .map((d) => truncate(String(d), 80)),
    evidenceRequirements: compactRequirements(
      researchPlan?.evidenceRequirements || [],
      limits.maxCoverage,
    ),
    criticOverall: {
      confidence: overall.confidence || 'LOW',
      evidenceSufficiency: overall.evidenceSufficiency || 'INSUFFICIENT',
      notes: truncate(overall.notes || '', 220),
    },
    criticDecisions: {
      instruction:
        'CRITIC DECISIONS ARE BINDING. Never promote EXCLUDE findings. QUALIFY must stay cautious. Confidence must not exceed confidenceCeiling. Resolve evidence via evidenceId → paperId in evidenceItems only.',
      includableFindings: findingsForPrompt,
      excludedFindings: excludedForPrompt,
    },
    contradictions: (critiqueResult.contradictions || [])
      .slice(0, limits.maxContradictions)
      .map((c) => ({
        id: c.id,
        description: truncate(c.description || '', 200),
        findingIds: (c.findingIds || []).map(String).slice(0, 6),
        paperIds: (c.paperIds || [])
          .map(String)
          .filter((id) => allowedPaperIds.has(id))
          .slice(0, 4),
        severity: c.severity,
      })),
    gaps: (critiqueResult.gaps || []).slice(0, limits.maxGaps).map((g) => ({
      id: g.id,
      description: truncate(g.description || '', 200),
      severity: g.severity,
    })),
    evidenceCoverage: (critiqueResult.evidenceCoverage || [])
      .slice(0, limits.maxCoverage)
      .map((c) => ({
        requirement: truncate(c.requirement || '', 140),
        status: c.status,
        notes: truncate(c.notes || '', 120),
      })),
    evidenceMatrixCoverage: evidenceChain.coverage
      ? {
          targetCount: evidenceChain.coverage.targetCount,
          searchedCount: evidenceChain.coverage.searchedCount,
          relevantCount: evidenceChain.coverage.relevantCount,
          fullTextCount: evidenceChain.coverage.fullTextCount,
          notSearchedCount: evidenceChain.coverage.notSearchedCount,
          coverageConfidenceCeiling: evidenceChain.coverageConfidenceCeiling,
          targetStates: evidenceChain.auditRows.slice(0, 12),
        }
      : null,
    retrievalLimitations: evidenceChain.retrievalLimitations.slice(0, 3),
    scientificGaps: evidenceChain.scientificGaps.slice(0, 6),
    researchSufficiency: {
      gateVerdict: researchSufficiency.gateVerdict || null,
      sparseCorpus: Boolean(researchSufficiency.sparseCorpus),
      notSearchedCount: researchSufficiency.notSearchedCount || 0,
      searchedRatio: researchSufficiency.searchedRatio || 0,
      usedRatio: researchSufficiency.usedRatio || 0,
      recoveryExhausted: Boolean(researchSufficiency.recoveryExhausted),
    },
    comparisonSufficiency: {
      canCompareMethods: comparisonSufficiency.canCompareMethods,
      canCompareAcrossDimensions: comparisonSufficiency.canCompareAcrossDimensions,
      directComparisonEvidence: comparisonSufficiency.directComparisonEvidence,
      indirectComparisonOnly: comparisonSufficiency.indirectComparisonOnly,
      methodsWithEvidence: (comparisonSufficiency.methodsWithEvidence || []).slice(0, 6),
      dimensionsWithEvidence: (comparisonSufficiency.dimensionsWithEvidence || []).slice(0, 6),
      winnerEstablishable: comparisonSufficiency.winnerEstablishable,
      comparisonBlockedReason: comparisonSufficiency.comparisonBlockedReason,
      methodDimensionMatrix: (comparisonSufficiency.methodDimensionMatrix || []).slice(0, 16),
    },
    synthesisQualityConstraints: {
      methods: extractResearchQueryIntents(researchQuestion).methods || [],
      dimensions:
        extractResearchQueryIntents(researchQuestion).evaluationDimensions || [],
      rules: [
        'Key findings must answer the research objective, not restate generic paper facts.',
        'Do not attribute underlying diagnostic-model accuracy to an XAI method unless evidence evaluates that relationship.',
        'Never generalize single-method evidence to cross-method conclusions without comparative support.',
        'Distinguish DIRECT, INDIRECT, and NO comparison; do not declare an overall winner unless winnerEstablishable is true.',
        'NOT_SEARCHED targets are retrieval limitations only — never scientific absence.',
        'Abstract-only evidence cannot support strong quantitative/clinical/comparative claims.',
      ],
    },
    evidenceItems,
    // Graph intentionally omitted from Synthesizer LLM context
    contextNotes: {
      findingsBounded,
      papersBounded,
      graphOmitted: true,
      noNewResearch: true,
      neverInventCitations: true,
      evidenceLevelGuidance:
        'FULL_TEXT may support detailed quantitative/clinical/comparative claims only when the cited evidence text contains that information. ABSTRACT or METADATA evidence must not be treated as equivalent to full-text quantitative or clinical proof.',
      retrievalVsScientificGaps:
        'retrievalLimitations describe search-budget coverage limits; scientificGaps describe what was searched/assessed but unsupported. Never equate NOT_SEARCHED with scientific absence.',
      comparativeSynthesis:
        'For comparative questions, attempt dimension-by-dimension reasoning using comparisonSufficiency.methodDimensionMatrix. If no winner is establishable, explain why using evidence level (direct vs indirect) rather than repeating generic insufficient-evidence wording.',
      coverageConfidenceCeiling: evidenceChain.coverageConfidenceCeiling,
    },
  }

  const payload = measureSynthesizerPayload(context, {
    includableAvailable: partition.includable.length,
    excludedAvailable: partition.excluded.length,
    papersAvailable: (evidencePackage.papers || []).length,
    limits: { ...limits },
  })

  return {
    context,
    allowedFindingIds,
    excludedFindingIds,
    qualifyFindingIds,
    criticConfidenceByFinding,
    allowedPaperIds,
    allowedEvidenceIds,
    papersById,
    evidenceIdToPaperId,
    partition,
    evidenceChain,
    matrixCoverage: evidenceChain.coverage,
    researchSufficiency,
    comparisonSufficiency,
    bounded: findingsBounded || papersBounded,
    stats: {
      includableFindings: includable.length,
      excludedFindings: partition.excluded.length,
      qualifiedFindings: partition.byHandling.QUALIFY.length,
      papersIncluded: evidenceItems.length,
      papersAvailable: (evidencePackage.papers || []).length,
      bounded: findingsBounded || papersBounded,
      serializedChars: payload.serializedChars,
      estimatedTokens: payload.estimatedTokens,
      graphOmitted: true,
    },
    payload,
  }
}

export default {
  buildSynthesizerContext,
  getSynthesizerContextLimits,
  measureSynthesizerPayload,
}
