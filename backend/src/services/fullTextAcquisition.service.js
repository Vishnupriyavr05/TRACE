/**
 * @fileoverview Deterministic full-text acquisition between Explorer and Evidence Analyst.
 * PDF resolve → validate → GROBID TEI → EvidenceItems (no LLM).
 */
import fs from 'fs/promises'
import path from 'path'
import { UPLOADS_ROOT } from '../config/multer/multer.config.js'
import {
  GROBID_BASE_URL,
  FULL_TEXT_MAX_EVIDENCE_PER_PAPER,
  FULL_TEXT_FETCH_TIMEOUT_MS,
} from '../config/environment/env.js'
import { envNumber, getProfileArtifactLimits } from '../ai/core/traceProfile.js'
import { selectAnalystPapers } from '../ai/agents/evidenceAnalyst.context.js'
import {
  EVIDENCE_LEVEL,
  evidenceLevelRank,
  normalizeEvidenceLevel,
} from '../ai/core/evidenceLevels.js'
import {
  classifyPaperOutcomeFailureStage,
  classifyPaperOutcomeFailureCategory,
} from '../ai/core/acquisitionFailureStages.js'
import { buildEvidenceLocationFromItem } from '../ai/core/evidenceLocation.js'
import { fetchBinary, isLikelyHtmlResponse } from '../integrations/utils/httpBinary.js'
import { isValidPdfBuffer } from '../integrations/utils/pdfValidate.js'
import {
  processFulltextDocument,
} from '../integrations/grobid/grobid.client.js'
import { enqueueGrobidWork, getGrobidQueueStats } from '../integrations/grobid/grobid.queue.js'
import { parseTeiToEvidenceItems } from '../integrations/grobid/teiEvidenceParser.js'
import { collectFullTextSources, resolveFullTextSourcesForPaper } from '../integrations/fulltext/fullTextSourceResolver.js'
import { discoverOaSources } from '../integrations/fulltext/oaSourceDiscovery.js'
import { fetchFullTextFromSources } from '../integrations/fulltext/fullTextFetcher.js'
import { FULL_TEXT_SOURCE_TYPE } from '../integrations/fulltext/fullTextSourceTypes.js'
import { parseJatsToEvidenceItems } from '../integrations/fulltext/jatsEvidenceParser.js'
import { extractHtmlArticleEvidenceItems } from '../integrations/fulltext/htmlArticleExtractor.js'
import * as documentService from './researchDocument.service.js'
import * as documentRepository from '../repositories/researchDocument.repository.js'
import {
  resolveDocumentAbsolutePath,
} from './uploadedPaperIntegration.service.js'
import {
  collectPdfCandidates,
  classifyFetchFailure,
} from './pdfCandidateResolver.js'
import { resolvePdfUrlsForPaper } from './pdfCandidateResolver.js'
import {
  resolveFullTextConcurrency,
  runWithBoundedConcurrency,
} from './fullTextConcurrency.js'

export { resolvePdfUrlsForPaper } from './pdfCandidateResolver.js'

/** Per HTTP attempt during TRACE acquisition (smoke tests use grobid.client directly). */
const DEFAULT_FULL_TEXT_GROBID_REQUEST_TIMEOUT_MS = 60_000
/** Hard cap per paper including queue wait, retries, and backoff. */
const DEFAULT_FULL_TEXT_GROBID_PAPER_DEADLINE_MS = 90_000
const GROBID_TRANSIENT_MAX_RETRIES = 1
const GROBID_RETRY_BACKOFF_MS = [2_000]

/**
 * @returns {boolean}
 */
export function isPdfAcquisitionDiagEnabled() {
  const flag = String(process.env.TRACE_PDF_ACQUISITION_DIAG || '').trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}

/**
 * @param {object} payload
 */
function logPdfAcquisitionDiag(payload) {
  if (!isPdfAcquisitionDiagEnabled()) return
  console.log('[TRACE PDF ACQUISITION]', JSON.stringify(payload))
}

/**
 * @param {typeof fetchBinary} fetchBinaryFn
 * @returns {typeof fetchBinary}
 */
function wrapFetchBinaryForDiag(fetchBinaryFn) {
  return async (url, options = {}) => {
    const startedAt = Date.now()
    try {
      const fetched = await fetchBinaryFn(url, options)
      const buffer = fetched.buffer
      logPdfAcquisitionDiag({
        phase: 'fetch_result',
        url,
        ok: true,
        elapsedMs: Date.now() - startedAt,
        httpStatus: 200,
        contentType: fetched.contentType || null,
        finalUrl: fetched.finalUrl || url,
        byteSize: buffer?.length ?? 0,
        isLikelyHtml: isLikelyHtmlResponse(buffer),
        isValidPdf: isValidPdfBuffer(buffer),
      })
      return fetched
    } catch (error) {
      const message = error?.message || String(error)
      const statusMatch = message.match(/HTTP (\d{3})/i)
      logPdfAcquisitionDiag({
        phase: 'fetch_result',
        url,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        httpStatus: statusMatch ? Number(statusMatch[1]) : null,
        error: message,
        classifiedFailure: classifyFetchFailure(message),
      })
      throw error
    }
  }
}

/**
 * @param {object} paper
 */
function logPdfPaperMetadata(paper) {
  logPdfAcquisitionDiag({
    phase: 'paper_metadata',
    paperId: paper.paperId,
    title: paper.title,
    doi: paper.doi || paper.externalIds?.doi || null,
    openAccess: paper.openAccess ?? paper.integrity?.openAccess ?? null,
    url: paper.url || null,
    pdfUrl: paper.pdfUrl || null,
    openAccessPdfUrl: paper.openAccessPdf?.url || paper.openAccessPdfUrl || null,
    bestOaPdfUrl: paper.best_oa_location?.pdf_url || null,
    primaryPdfUrl: paper.primary_location?.pdf_url || null,
    openAlexOaUrl: paper.open_access?.oa_url || null,
    source: paper.source || null,
    externalIds: paper.externalIds || null,
  })
}

/**
 * @param {string} paperId
 * @param {import('./pdfCandidateResolver.js').PdfCandidate[]} candidates
 */
function logPdfCandidates(paperId, candidates) {
  logPdfAcquisitionDiag({
    phase: 'pdf_candidates',
    paperId,
    candidateCount: candidates.length,
    candidates: candidates.map((candidate) => ({
      url: candidate.url,
      kind: candidate.kind,
      priority: candidate.priority,
    })),
  })
}

/**
 * @param {object} outcome
 */
function logPdfPaperOutcome(outcome) {
  logPdfAcquisitionDiag({
    phase: 'paper_outcome',
    paperId: outcome.paperId,
    status: outcome.status,
    reason: outcome.reason,
    fallbackReason: outcome.fallbackReason,
    failureStage: outcome.failureStage,
    failureCategory: outcome.failureCategory,
    evidenceLevel: outcome.evidenceLevel,
    grobidAttempted: outcome.grobidAttempted,
    skippedAcquisition: outcome.skippedAcquisition || false,
    candidatesGenerated: outcome.candidatesGenerated ?? null,
    candidatesAttempted: outcome.candidatesAttempted ?? null,
    candidatesFailed: outcome.candidatesFailed ?? null,
    successfulPdfCandidate: outcome.successfulPdfCandidate ?? null,
    finalFallbackReason: outcome.finalFallbackReason ?? null,
    pdfUrlSelected: outcome.pdfUrlSelected || null,
    fetchAttempts: (outcome.pdfFetchAttempts || []).map((attempt) => ({
      url: attempt.url,
      kind: attempt.kind,
      priority: attempt.priority,
      status: attempt.status,
      error: attempt.error || null,
    })),
  })
}

/**
 * @param {object} outcome
 * @returns {object}
 */
function stampAcquisitionOutcomeDiagnostics(outcome) {
  outcome.failureStage = classifyPaperOutcomeFailureStage(outcome)
  outcome.failureCategory = classifyPaperOutcomeFailureCategory(outcome)
  return outcome
}

/**
 * @returns {number}
 */
export function resolveFullTextGrobidRequestTimeoutMs() {
  return envNumber(
    'FULL_TEXT_GROBID_TIMEOUT_MS',
    envNumber('GROBID_TIMEOUT_MS', DEFAULT_FULL_TEXT_GROBID_REQUEST_TIMEOUT_MS),
  )
}

/**
 * @returns {number}
 */
export function resolveFullTextGrobidPaperDeadlineMs() {
  return envNumber(
    'FULL_TEXT_GROBID_PAPER_DEADLINE_MS',
    DEFAULT_FULL_TEXT_GROBID_PAPER_DEADLINE_MS,
  )
}

/**
 * @returns {number}
 */
export function resolveFullTextMaxPapers() {
  const limits = getProfileArtifactLimits()
  return envNumber('FULL_TEXT_MAX_PAPERS', limits.maxPapers)
}

/**
 * GROBID acquisition cap (subset of ranked full-text candidates).
 *
 * @returns {number}
 */
/**
 * @returns {number}
 */
export function resolveFullTextConcurrencyLimit() {
  return resolveFullTextConcurrency()
}

export function resolveFullTextTopK() {
  const limits = getProfileArtifactLimits()
  const profileDefault = limits.profile === 'minimum' ? 6 : 8
  const topK = envNumber('FULL_TEXT_TOP_K', profileDefault)
  return Math.max(1, topK)
}

/**
 * @param {object|null|undefined} evidencePackage
 * @returns {object[]}
 */
function collectPackageEvidenceItems(evidencePackage) {
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
 * @param {object|null|undefined} item
 * @returns {boolean}
 */
function hasUsableEvidenceText(item) {
  return Boolean(String(item?.text || item?.excerpt || '').trim())
}

/**
 * @param {object|null|undefined} evidencePackage
 * @param {string} paperId
 * @returns {boolean}
 */
export function paperHasSuccessfulFullText(evidencePackage, paperId) {
  const pid = String(paperId)
  const priorLevel = evidencePackage?.paperEvidenceLevels?.[pid]
  if (String(priorLevel || '').toUpperCase() === EVIDENCE_LEVEL.FULL_TEXT) {
    return true
  }

  const priorOutcome = (evidencePackage?.fullTextAcquisition?.paperOutcomes || []).find(
    (row) => String(row.paperId) === pid,
  )
  if (priorOutcome?.status === 'full_text') {
    return true
  }

  const paper = (evidencePackage?.papers || []).find(
    (row) => String(row.paperId) === pid,
  )
  if (String(paper?.evidenceLevel || '').toUpperCase() === EVIDENCE_LEVEL.FULL_TEXT) {
    return true
  }

  return collectPackageEvidenceItems(evidencePackage).some(
    (item) =>
      String(item.paperId) === pid &&
      normalizeEvidenceLevel(item.evidenceLevel) === EVIDENCE_LEVEL.FULL_TEXT,
  )
}

/**
 * Paper has reusable FULL_TEXT evidence from a prior successful acquisition.
 * Requires usable evidence items — markers without items are not reusable.
 *
 * @param {object|null|undefined} evidencePackage
 * @param {string} paperId
 * @returns {boolean}
 */
export function paperHasReusableFullText(evidencePackage, paperId) {
  const pid = String(paperId)
  const fullTextItems = collectPackageEvidenceItems(evidencePackage).filter(
    (item) =>
      String(item.paperId) === pid &&
      normalizeEvidenceLevel(item.evidenceLevel) === EVIDENCE_LEVEL.FULL_TEXT &&
      hasUsableEvidenceText(item),
  )
  if (fullTextItems.length === 0) {
    return false
  }

  const priorOutcome = (evidencePackage?.fullTextAcquisition?.paperOutcomes || []).find(
    (row) => String(row.paperId) === pid,
  )
  if (
    priorOutcome?.status === 'fallback' ||
    priorOutcome?.status === 'grobid_failed'
  ) {
    return false
  }

  return true
}

/**
 * @param {object[]} primaryItems
 * @param {object[]} secondaryItems
 * @returns {object[]}
 */
function mergeEvidenceItemsById(primaryItems, secondaryItems) {
  /** @type {Map<string, object>} */
  const byId = new Map()
  for (const item of primaryItems) {
    const evidenceId = String(item?.evidenceId || '')
    if (!evidenceId) continue
    byId.set(evidenceId, item)
  }
  for (const item of secondaryItems) {
    const evidenceId = String(item?.evidenceId || '')
    if (!evidenceId) continue
    if (!byId.has(evidenceId)) {
      byId.set(evidenceId, item)
      continue
    }
    const existing = byId.get(evidenceId)
    const existingLevel = normalizeEvidenceLevel(existing.evidenceLevel)
    const incomingLevel = normalizeEvidenceLevel(item.evidenceLevel)
    if (evidenceLevelRank(incomingLevel) > evidenceLevelRank(existingLevel)) {
      byId.set(evidenceId, item)
    }
  }
  return [...byId.values()]
}

/**
 * @param {object[]|undefined|null} primaryOutcomes
 * @param {object[]|undefined|null} secondaryOutcomes
 * @returns {object[]}
 */
function mergeAcquisitionPaperOutcomes(primaryOutcomes, secondaryOutcomes) {
  /** @type {Map<string, object>} */
  const byPaper = new Map()
  for (const outcome of primaryOutcomes || []) {
    const paperId = String(outcome?.paperId || '')
    if (!paperId) continue
    byPaper.set(paperId, outcome)
  }
  for (const outcome of secondaryOutcomes || []) {
    const paperId = String(outcome?.paperId || '')
    if (!paperId) continue
    const existing = byPaper.get(paperId)
    if (!existing) {
      byPaper.set(paperId, outcome)
      continue
    }
    if (outcome.status === 'full_text' || outcome.skippedAcquisition) {
      byPaper.set(paperId, outcome)
    }
  }
  return [...byPaper.values()]
}

/**
 * @param {object|null|undefined} evidencePackage
 * @param {object[]} extractedEvidenceItems
 * @param {Map<string, string>} evidenceIdToPaperId
 * @param {Record<string, string>} paperEvidenceLevels
 */
function seedPriorAcquiredEvidence(
  evidencePackage,
  extractedEvidenceItems,
  evidenceIdToPaperId,
  paperEvidenceLevels,
) {
  const items = collectPackageEvidenceItems(evidencePackage)
  const seenIds = new Set(
    extractedEvidenceItems.map((item) => String(item.evidenceId)),
  )

  for (const item of items) {
    const evidenceId = String(item.evidenceId || '')
    if (!evidenceId || seenIds.has(evidenceId)) continue
    extractedEvidenceItems.push(item)
    seenIds.add(evidenceId)
    if (item.paperId) {
      const pid = String(item.paperId)
      evidenceIdToPaperId.set(evidenceId, pid)
      const itemLevel = normalizeEvidenceLevel(item.evidenceLevel)
      const current = paperEvidenceLevels[pid]
      if (!current) {
        paperEvidenceLevels[pid] = itemLevel
      } else {
        const normalized = normalizeEvidenceLevel(current)
        paperEvidenceLevels[pid] =
          evidenceLevelRank(normalized) >= evidenceLevelRank(itemLevel)
            ? normalized
            : itemLevel
      }
    }
  }

  const storedMap = evidencePackage?.evidenceIdToPaperId
  if (storedMap && typeof storedMap === 'object') {
    for (const [evidenceId, paperId] of Object.entries(storedMap)) {
      const eid = String(evidenceId)
      if (!evidenceIdToPaperId.has(eid)) {
        evidenceIdToPaperId.set(eid, String(paperId))
      }
    }
  }

  for (const [paperId, level] of Object.entries(
    evidencePackage?.paperEvidenceLevels || {},
  )) {
    const pid = String(paperId)
    const incoming = normalizeEvidenceLevel(level)
    const current = paperEvidenceLevels[pid]
    if (!current) {
      paperEvidenceLevels[pid] = incoming
      continue
    }
    const normalized = normalizeEvidenceLevel(current)
    paperEvidenceLevels[pid] =
      evidenceLevelRank(normalized) >= evidenceLevelRank(incoming)
        ? normalized
        : incoming
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isTransientGrobidError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  if (error?.name === 'AbortError') return true
  return (
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('http 503') ||
    message.includes('grobid http 503') ||
    message.includes('service unavailable') ||
    message.includes('econnreset') ||
    message.includes('econnrefused')
  )
}

/**
 * @param {Buffer} buffer
 * @param {object} deps
 * @param {object} diagnostics
 * @returns {Promise<{ tei: string, ok: true }>}
 */
async function extractWithGrobid(buffer, deps, diagnostics) {
  if (!deps.grobidBaseUrl) {
    throw new Error('grobid_unconfigured')
  }

  const paperDeadlineMs =
    deps.grobidPaperDeadlineMs ?? resolveFullTextGrobidPaperDeadlineMs()
  const requestTimeoutMs =
    deps.grobidRequestTimeoutMs ?? resolveFullTextGrobidRequestTimeoutMs()
  const maxRetries = deps.grobidTransientMaxRetries ?? GROBID_TRANSIENT_MAX_RETRIES
  const maxAttempts = 1 + maxRetries
  const startedAt = Date.now()
  let lastError = null
  const grobidStartedAt = new Date().toISOString()

  diagnostics.paperDeadlineMs = paperDeadlineMs
  diagnostics.requestTimeoutMs = requestTimeoutMs

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const elapsedMs = Date.now() - startedAt
    const remainingMs = paperDeadlineMs - elapsedMs
    if (remainingMs <= 0) {
      throw new Error('GROBID paper deadline exceeded')
    }

    const attemptTimeoutMs = Math.min(requestTimeoutMs, remainingMs)
    diagnostics.attempts = attempt
    diagnostics.attemptTimeoutMs = attemptTimeoutMs

    try {
      const grobidCallStartedAt = Date.now()
      const timed = await deps.enqueueGrobidWork(async () => {
        try {
          const tei = await deps.processFulltextDocument(buffer, {
            segmentSentences: true,
            baseUrl: deps.grobidBaseUrl,
            timeoutMs: attemptTimeoutMs,
            skipHealthCheck: true,
          })
          return {
            tei,
            diagnostics: {
              attempted: true,
              startedAt: grobidStartedAt,
              elapsedMs: Date.now() - grobidCallStartedAt,
              httpStatus: 200,
              success: true,
              errorType: null,
              errorMessage: null,
            },
          }
        } catch (error) {
          return {
            tei: null,
            diagnostics: {
              attempted: true,
              startedAt: grobidStartedAt,
              elapsedMs: Date.now() - grobidCallStartedAt,
              httpStatus: null,
              success: false,
              errorType: error?.name || 'Error',
              errorMessage: error?.message || String(error),
            },
            error,
          }
        }
      })
      diagnostics.queueWaitMs = timed.queueWaitMs
      diagnostics.processingMs = timed.processingMs
      diagnostics.totalElapsedMs = Date.now() - startedAt
      diagnostics.grobidDiagnostics = timed.result?.diagnostics || null
      if (timed.result?.error) {
        throw timed.result.error
      }
      const tei = timed.result?.tei
      if (!tei) {
        throw new Error(
          diagnostics.grobidDiagnostics?.errorMessage || 'grobid_failed',
        )
      }
      return { tei, ok: true }
    } catch (error) {
      lastError = error
      diagnostics.lastError = error?.message || String(error)
      diagnostics.totalElapsedMs = Date.now() - startedAt
      diagnostics.grobidDiagnostics = {
        attempted: true,
        startedAt: grobidStartedAt,
        elapsedMs: diagnostics.totalElapsedMs,
        httpStatus: null,
        success: false,
        errorType: error?.name || 'Error',
        errorMessage: error?.message || String(error),
      }
      if (attempt < maxAttempts && isTransientGrobidError(error)) {
        const backoff = GROBID_RETRY_BACKOFF_MS[attempt - 1] ?? 2_000
        const afterBackoffMs = Date.now() - startedAt + backoff
        if (afterBackoffMs >= paperDeadlineMs) {
          throw error
        }
        diagnostics.retryBackoffMs = backoff
        if (deps.sleep) {
          await deps.sleep(backoff)
        }
        continue
      }
      throw error
    }
  }

  throw lastError || new Error('grobid_failed')
}

/**
 * @param {string} userId
 * @param {string} sessionId
 * @param {object} paper
 * @param {object[]} sessionDocuments
 * @returns {Promise<string|null>}
 */
export async function resolveUploadedPdfPath(
  userId,
  sessionId,
  paper,
  sessionDocuments = [],
) {
  const uploadDocumentId =
    paper?.externalIds?.uploadDocumentId ||
    paper?.uploadDocumentId ||
    paper?.raw?.uploadDocumentId ||
    null

  if (uploadDocumentId) {
    let docs = sessionDocuments
    if (!docs.length) {
      try {
        docs = await documentRepository.getDocumentsBySession(sessionId, {
          includeStoragePath: true,
        })
      } catch {
        docs = []
      }
    }
    const linked = docs.find(
      (doc) => String(doc._id || doc.id || '') === String(uploadDocumentId),
    )
    if (linked) {
      const absolutePath = resolveDocumentAbsolutePath(linked)
      if (absolutePath) return absolutePath
      if (linked.storedName) {
        return path.join(
          UPLOADS_ROOT,
          String(userId),
          String(sessionId),
          linked.storedName,
        )
      }
    }
  }

  const title = String(paper.title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  const doi = String(paper.doi || paper.externalIds?.doi || '')
    .toLowerCase()
    .trim()

  for (const doc of sessionDocuments) {
    const name = String(doc.originalName || '').toLowerCase()
    if (doi && name.includes(doi.replace(/\//g, '-'))) {
      return path.join(
        UPLOADS_ROOT,
        String(userId),
        String(sessionId),
        doc.storedName,
      )
    }
    if (title && title.length > 12 && name.includes(title.slice(0, 24))) {
      return path.join(
        UPLOADS_ROOT,
        String(userId),
        String(sessionId),
        doc.storedName,
      )
    }
  }
  return null
}

/**
 * @param {object[]} attempts
 * @returns {object[]}
 */
function mapFetchAttemptsForOutcome(attempts) {
  return (attempts || []).map((attempt) => ({
    url: attempt.url,
    kind: attempt.kind || attempt.type,
    type: attempt.type,
    source: attempt.source,
    priority: attempt.priority,
    status: attempt.failureReason ? attempt.failureReason : 'success',
    httpStatus: attempt.httpStatus ?? null,
    contentType: attempt.contentType ?? null,
    responseBytes: attempt.responseBytes ?? null,
    isPdf: attempt.isPdf ?? null,
    pdfValidationPassed: attempt.pdfValidationPassed ?? attempt.isPdf ?? null,
    landingDiscoveryRan: attempt.landingDiscoveryRan ?? false,
    discoveredAssetUrls: attempt.discoveredAssetUrls ?? [],
    failureReason: attempt.failureReason ?? null,
    elapsedMs: attempt.elapsedMs ?? null,
    error: attempt.error || null,
  }))
}

/**
 * @param {object} outcome
 * @returns {object}
 */
function fullTextFetchOutcomeFields(outcome) {
  return {
    pdfUrlsTried: outcome.pdfUrlsTried,
    pdfUrlSelected: outcome.pdfUrlSelected,
    pdfFetchAttempts: outcome.pdfFetchAttempts,
    fullTextFetchAttempts: outcome.fullTextFetchAttempts,
    resolvedType: outcome.resolvedType ?? null,
    successfulFullTextSource: outcome.successfulFullTextSource ?? null,
    candidatesGenerated: outcome.candidatesGenerated,
    candidatesAttempted: outcome.candidatesAttempted,
    candidatesFailed: outcome.candidatesFailed,
    successfulPdfCandidate: outcome.successfulPdfCandidate,
    finalFallbackReason: outcome.finalFallbackReason,
    discoveredAssetUrls: outcome.discoveredAssetUrls ?? [],
    sourceDiscoveryProviders: outcome.sourceDiscoveryProviders ?? null,
    repositoryApiAttempted: outcome.repositoryApiAttempted ?? false,
    repositoryApiProvider: outcome.repositoryApiProvider ?? null,
    repositoryApiResolved: outcome.repositoryApiResolved ?? false,
    repositoryApiSources: outcome.repositoryApiSources ?? [],
    repositoryApiFailureReason: outcome.repositoryApiFailureReason ?? null,
    grobidDiagnostics: outcome.grobidDiagnostics ?? null,
  }
}

/**
 * @param {object} outcome
 * @returns {object}
 */
function pdfFetchOutcomeFields(outcome) {
  return fullTextFetchOutcomeFields(outcome)
}

/**
 * @param {object} paper
 * @param {number} paperIndex
 * @param {{ reason?: string }} [options]
 * @returns {object[]}
 */
function buildAbstractFallbackItems(paper, paperIndex, options = {}) {
  const reason = options.reason || 'no_pdf'
  const paperId = String(paper.paperId)
  const availability =
    reason === 'invalid_pdf'
      ? 'invalid_pdf'
      : reason === 'no_pdf' || reason === 'no_pdf_url'
        ? 'no_pdf_url'
        : reason.startsWith('grobid')
          ? 'grobid_failed'
          : reason === 'grobid_unconfigured' || reason.startsWith('grobid_unavailable')
            ? 'grobid_unavailable'
            : 'abstract_fallback'

  const abstract = String(paper.abstract || '').trim()
  if (abstract) {
    return [
      {
        evidenceId: `EV${paperIndex}-ABS`,
        paperId,
        section: 'abstract',
        sectionIndex: 0,
        paragraphIndex: 1,
        sentenceIndex: null,
        page: null,
        text: abstract.slice(0, 1200),
        sourceType: 'abstract',
        evidenceLevel: EVIDENCE_LEVEL.ABSTRACT,
        availability,
        fallbackReason: reason,
        role: 'supporting',
      },
    ]
  }
  const title = String(paper.title || '').trim()
  if (!title) return []
  return [
    {
      evidenceId: `EV${paperIndex}-META`,
      paperId,
      section: 'metadata',
      sectionIndex: 0,
      paragraphIndex: 1,
      sentenceIndex: null,
      page: null,
      text: title,
      sourceType: 'metadata',
      evidenceLevel: EVIDENCE_LEVEL.METADATA,
      availability: 'unavailable',
      fallbackReason: reason,
      role: 'supporting',
    },
  ]
}

/**
 * Score evidence items by query relevance (deterministic token overlap).
 *
 * @param {object[]} items
 * @param {string} researchQuestion
 * @param {number} maxItems
 * @returns {object[]}
 */
export function selectRelevantEvidenceItems(
  items,
  researchQuestion = '',
  maxItems = 80,
) {
  const queryTokens = new Set(
    String(researchQuestion || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  )

  const scored = (items || []).map((item) => {
    const text = String(item.text || item.abstract || '').toLowerCase()
    const tokens = text.split(/[^a-z0-9]+/).filter((t) => t.length > 2)
    let overlap = 0
    for (const token of tokens) {
      if (queryTokens.has(token)) overlap += 1
    }
    const levelBoost =
      item.evidenceLevel === EVIDENCE_LEVEL.FULL_TEXT
        ? 3
        : item.evidenceLevel === EVIDENCE_LEVEL.ABSTRACT
          ? 1
          : 0
    return { item, score: overlap + levelBoost }
  })

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.item.evidenceId).localeCompare(String(b.item.evidenceId)),
  )

  const perPaper = new Map()
  const selected = []
  for (const row of scored) {
    const pid = String(row.item.paperId)
    const count = perPaper.get(pid) || 0
    if (count >= FULL_TEXT_MAX_EVIDENCE_PER_PAPER) continue
    selected.push(row.item)
    perPaper.set(pid, count + 1)
    if (selected.length >= maxItems) break
  }

  return selected
}

/**
 * @param {object[]} items
 * @param {string} paperId
 * @returns {object|null}
 */
function pickPrimaryEvidenceItem(items, paperId) {
  const paperItems = (items || []).filter(
    (item) => String(item.paperId) === String(paperId),
  )
  if (!paperItems.length) return null
  const fullText = paperItems.filter(
    (item) => item.evidenceLevel === EVIDENCE_LEVEL.FULL_TEXT,
  )
  const pool = fullText.length ? fullText : paperItems
  return (
    pool.find((item) => buildEvidenceLocationFromItem(item)) ||
    pool[0] ||
    null
  )
}

/**
 * @param {object} ctx
 * @returns {Promise<object>}
 */
async function acquireFullTextForOnePaper(ctx) {
  const {
    paper,
    paperId,
    paperIndex,
    userId,
    sessionId,
    sessionDocuments,
    evidencePackage,
    deps,
  } = ctx

  /** @type {object[]} */
  const evidenceItems = []
  /** @type {Map<string, string>} */
  const localEvidenceIdToPaperId = new Map()
  let paperEvidenceLevel = null
  let paperFallbackReason = null

    let outcome = {
      paperId,
      status: 'fallback',
      reason: 'no_pdf',
      fallbackReason: 'no_pdf',
      evidenceLevel: EVIDENCE_LEVEL.ABSTRACT,
      itemCount: 0,
      pdfUrlsTried: [],
      pdfUrlSelected: null,
      pdfFetchAttempts: [],
      grobidAttempted: false,
      attempts: 0,
      queueWaitMs: null,
      processingMs: null,
      totalElapsedMs: null,
      paperDeadlineMs: null,
    }

    /** @type {Buffer|null} */
    let contentBuffer = null
    let source = null
    let resolvedType = null
    let fetchReason = 'no_pdf'
    let selectedSource = null

    const uploadPath = await resolveUploadedPdfPath(
      userId,
      sessionId,
      paper,
      sessionDocuments,
    )
    if (uploadPath) {
      try {
        contentBuffer = await deps.readFile(uploadPath)
        source = 'upload'
        resolvedType = FULL_TEXT_SOURCE_TYPE.PDF
        selectedSource = { url: uploadPath, type: 'pdf', source: 'upload' }
      } catch {
        contentBuffer = null
      }
    }

    if (!contentBuffer) {
      logPdfPaperMetadata(paper)
      const resolveFn = deps.resolveFullTextSourcesForPaper || resolveFullTextSourcesForPaper
      const resolved = await resolveFn(paper, {
        ...deps,
        discoverOaSources: deps.discoverOaSources || discoverOaSources,
      })
      const sources = resolved.sources
      outcome.sourceDiscoveryProviders = resolved.sourceDiscoveryProviders || []
      if (resolved.repositoryApiDiagnostics) {
        outcome.repositoryApiAttempted =
          resolved.repositoryApiDiagnostics.repositoryApiAttempted ?? false
        outcome.repositoryApiProvider =
          resolved.repositoryApiDiagnostics.repositoryApiProvider ?? null
        outcome.repositoryApiResolved =
          resolved.repositoryApiDiagnostics.repositoryApiResolved ?? false
        outcome.repositoryApiSources =
          resolved.repositoryApiDiagnostics.repositoryApiSources ?? []
        outcome.repositoryApiFailureReason =
          resolved.repositoryApiDiagnostics.repositoryApiFailureReason ?? null
      }
      logPdfCandidates(paperId, collectPdfCandidates(paper))
      outcome.pdfUrlsTried = sources.map((row) => row.url)
      outcome.candidatesGenerated = sources.length
      const fetched = await fetchFullTextFromSources(sources, {
        ...deps,
        timeoutMs: deps.fullTextFetchTimeoutMs ?? FULL_TEXT_FETCH_TIMEOUT_MS,
      })
      const mappedAttempts = mapFetchAttemptsForOutcome(fetched.attempts)
      outcome.fullTextFetchAttempts = mappedAttempts
      outcome.pdfFetchAttempts = mappedAttempts
      outcome.candidatesAttempted = fetched.attempts.length
      outcome.candidatesFailed = fetched.attempts.filter(
        (row) => row.failureReason,
      ).length
      outcome.discoveredAssetUrls = fetched.discoveredAssetUrls || []
      selectedSource = fetched.selectedSource
      outcome.successfulFullTextSource = selectedSource?.url || null
      outcome.resolvedType = fetched.resolvedType
      if (
        fetched.buffer &&
        fetched.resolvedType === FULL_TEXT_SOURCE_TYPE.PDF
      ) {
        outcome.successfulPdfCandidate = fetched.selectedSource?.url || null
        outcome.pdfUrlSelected = fetched.selectedSource?.url || null
      } else {
        outcome.successfulPdfCandidate = null
        outcome.pdfUrlSelected = null
      }
      if (fetched.buffer && fetched.resolvedType) {
        contentBuffer = fetched.buffer
        source = fetched.selectedSource?.source || 'remote'
        resolvedType = fetched.resolvedType
        fetchReason = null
        outcome.finalFallbackReason = null
      } else {
        fetchReason = fetched.fetchReason || 'no_pdf'
        outcome.finalFallbackReason = fetchReason
      }
      if (!contentBuffer && !sources.length) {
        fetchReason = 'no_pdf_url'
        outcome.finalFallbackReason = 'no_pdf_url'
      }
    } else {
      outcome.pdfUrlSelected = selectedSource?.url || null
      outcome.successfulPdfCandidate = selectedSource?.url || null
      outcome.successfulFullTextSource = selectedSource?.url || null
      outcome.resolvedType = FULL_TEXT_SOURCE_TYPE.PDF
    }

    if (
      contentBuffer &&
      resolvedType === FULL_TEXT_SOURCE_TYPE.PDF &&
      deps.isValidPdfBuffer(contentBuffer)
    ) {
      if (!deps.grobidBaseUrl) {
        const reason = 'grobid_unconfigured'
        paperFallbackReason = reason
        const fallback = buildAbstractFallbackItems(paper, paperIndex, { reason })
        for (const item of fallback) {
          evidenceItems.push(item)
          localEvidenceIdToPaperId.set(String(item.evidenceId), paperId)
        }
        paperEvidenceLevel =
          fallback[0]?.evidenceLevel || EVIDENCE_LEVEL.UNAVAILABLE
        outcome = {
          paperId,
          status: 'fallback',
          reason,
          fallbackReason: reason,
          evidenceLevel: paperEvidenceLevel,
          itemCount: fallback.length,
          ...fullTextFetchOutcomeFields(outcome),
          grobidAttempted: false,
          attempts: 0,
          queueWaitMs: null,
          processingMs: null,
        }
      } else {
        const diagnostics = {
          attempts: 0,
          queueWaitMs: null,
          processingMs: null,
          totalElapsedMs: null,
          paperDeadlineMs: null,
          requestTimeoutMs: null,
        }
        try {
          const { tei } = await extractWithGrobid(contentBuffer, deps, diagnostics)
          const items = parseTeiToEvidenceItems(tei, paperId, {
            paperIndex,
            maxItems: FULL_TEXT_MAX_EVIDENCE_PER_PAPER * 4,
          })
          if (items.length) {
            for (const item of items) {
              evidenceItems.push(item)
              localEvidenceIdToPaperId.set(String(item.evidenceId), paperId)
            }
            paperEvidenceLevel = EVIDENCE_LEVEL.FULL_TEXT
            outcome = {
              paperId,
              status: 'full_text',
              reason: source,
              fallbackReason: null,
              evidenceLevel: EVIDENCE_LEVEL.FULL_TEXT,
              itemCount: items.length,
              ...fullTextFetchOutcomeFields(outcome),
              grobidAttempted: true,
              attempts: diagnostics.attempts,
              queueWaitMs: diagnostics.queueWaitMs,
              processingMs: diagnostics.processingMs,
              totalElapsedMs: diagnostics.totalElapsedMs,
              paperDeadlineMs: diagnostics.paperDeadlineMs,
              grobidDiagnostics: diagnostics.grobidDiagnostics,
            }
          } else {
            throw new Error('GROBID returned no extractable sentences')
          }
        } catch (error) {
          const reason = error?.message || 'grobid_failed'
          paperFallbackReason = reason
          outcome = {
            paperId,
            status: 'grobid_failed',
            reason,
            fallbackReason: reason,
            evidenceLevel: EVIDENCE_LEVEL.ABSTRACT,
            itemCount: 0,
            ...fullTextFetchOutcomeFields(outcome),
            grobidAttempted: true,
            attempts: diagnostics.attempts,
            queueWaitMs: diagnostics.queueWaitMs,
            processingMs: diagnostics.processingMs,
            totalElapsedMs: diagnostics.totalElapsedMs,
            paperDeadlineMs: diagnostics.paperDeadlineMs,
            grobidDiagnostics: diagnostics.grobidDiagnostics,
          }
          const fallback = buildAbstractFallbackItems(paper, paperIndex, {
            reason,
          })
          for (const item of fallback) {
            evidenceItems.push(item)
            localEvidenceIdToPaperId.set(String(item.evidenceId), paperId)
          }
          paperEvidenceLevel =
            fallback[0]?.evidenceLevel || EVIDENCE_LEVEL.ABSTRACT
          outcome.itemCount = fallback.length
        }
      }
    } else if (
      contentBuffer &&
      resolvedType === FULL_TEXT_SOURCE_TYPE.XML
    ) {
      const items = parseJatsToEvidenceItems(
        contentBuffer.toString('utf8'),
        paperId,
        { paperIndex, maxItems: FULL_TEXT_MAX_EVIDENCE_PER_PAPER * 4 },
      )
      if (items.length) {
        for (const item of items) {
          evidenceItems.push(item)
          localEvidenceIdToPaperId.set(String(item.evidenceId), paperId)
        }
        paperEvidenceLevel = EVIDENCE_LEVEL.FULL_TEXT
        outcome = {
          paperId,
          status: 'full_text',
          reason: source || 'xml',
          fallbackReason: null,
          evidenceLevel: EVIDENCE_LEVEL.FULL_TEXT,
          itemCount: items.length,
          ...fullTextFetchOutcomeFields(outcome),
          grobidAttempted: false,
          attempts: 0,
          queueWaitMs: null,
          processingMs: null,
        }
      } else {
        const reason = 'xml_parse_empty'
        paperFallbackReason = reason
        const fallback = buildAbstractFallbackItems(paper, paperIndex, { reason })
        for (const item of fallback) {
          evidenceItems.push(item)
          localEvidenceIdToPaperId.set(String(item.evidenceId), paperId)
        }
        paperEvidenceLevel =
          fallback[0]?.evidenceLevel || EVIDENCE_LEVEL.ABSTRACT
        outcome = {
          paperId,
          status: 'fallback',
          reason,
          fallbackReason: reason,
          evidenceLevel: paperEvidenceLevel,
          itemCount: fallback.length,
          ...fullTextFetchOutcomeFields(outcome),
          grobidAttempted: false,
          attempts: 0,
          queueWaitMs: null,
          processingMs: null,
        }
      }
    } else if (
      contentBuffer &&
      resolvedType === FULL_TEXT_SOURCE_TYPE.HTML
    ) {
      const items = extractHtmlArticleEvidenceItems(
        contentBuffer.toString('utf8'),
        paperId,
        { paperIndex, maxItems: FULL_TEXT_MAX_EVIDENCE_PER_PAPER * 4 },
      )
      if (items.length) {
        for (const item of items) {
          evidenceItems.push(item)
          localEvidenceIdToPaperId.set(String(item.evidenceId), paperId)
        }
        paperEvidenceLevel = EVIDENCE_LEVEL.FULL_TEXT
        outcome = {
          paperId,
          status: 'full_text',
          reason: source || 'html',
          fallbackReason: null,
          evidenceLevel: EVIDENCE_LEVEL.FULL_TEXT,
          itemCount: items.length,
          ...fullTextFetchOutcomeFields(outcome),
          grobidAttempted: false,
          attempts: 0,
          queueWaitMs: null,
          processingMs: null,
        }
      } else {
        const reason = 'html_parse_empty'
        paperFallbackReason = reason
        const fallback = buildAbstractFallbackItems(paper, paperIndex, { reason })
        for (const item of fallback) {
          evidenceItems.push(item)
          localEvidenceIdToPaperId.set(String(item.evidenceId), paperId)
        }
        paperEvidenceLevel =
          fallback[0]?.evidenceLevel || EVIDENCE_LEVEL.ABSTRACT
        outcome = {
          paperId,
          status: 'fallback',
          reason,
          fallbackReason: reason,
          evidenceLevel: paperEvidenceLevel,
          itemCount: fallback.length,
          ...fullTextFetchOutcomeFields(outcome),
          grobidAttempted: false,
          attempts: 0,
          queueWaitMs: null,
          processingMs: null,
        }
      }
    } else {
      let reason = fetchReason || 'no_pdf'
      if (contentBuffer && resolvedType === FULL_TEXT_SOURCE_TYPE.PDF && !deps.isValidPdfBuffer(contentBuffer)) {
        reason = 'invalid_pdf'
      } else if (!contentBuffer) {
        reason = fetchReason || 'no_pdf_url'
      }
      paperFallbackReason = reason

      const fallback = buildAbstractFallbackItems(paper, paperIndex, { reason })
      for (const item of fallback) {
        evidenceItems.push(item)
        localEvidenceIdToPaperId.set(String(item.evidenceId), paperId)
      }
      paperEvidenceLevel =
        fallback[0]?.evidenceLevel || EVIDENCE_LEVEL.UNAVAILABLE
      outcome = {
        paperId,
        status: 'fallback',
        reason,
        fallbackReason: reason,
        evidenceLevel: paperEvidenceLevel,
        itemCount: fallback.length,
        ...fullTextFetchOutcomeFields(outcome),
        grobidAttempted: false,
        attempts: 0,
        queueWaitMs: null,
        processingMs: null,
      }
    }

    const stampedOutcome = stampAcquisitionOutcomeDiagnostics(outcome)
    return {
      paperId,
      outcome: stampedOutcome,
      evidenceItems,
      evidenceIdToPaperId: Object.fromEntries(localEvidenceIdToPaperId),
      paperEvidenceLevel,
      paperFallbackReason,
    }
}

/**
 * Acquire full text + GROBID evidence for analyst-selected papers.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {object} evidencePackage
 * @param {{ researchQuestion?: string, deps?: object }} [options]
 * @returns {Promise<object>}
 */
export async function acquireFullTextEvidence(
  userId,
  sessionId,
  evidencePackage,
  options = {},
) {
  const baseDeps = {
    fetchBinary,
    isValidPdfBuffer,
    isLikelyHtmlResponse,
    processFulltextDocument,
    enqueueGrobidWork,
    getGrobidQueueStats,
    readFile: fs.readFile,
    listSessionDocuments: documentService.listSessionDocuments,
    grobidBaseUrl: GROBID_BASE_URL,
    grobidRequestTimeoutMs: resolveFullTextGrobidRequestTimeoutMs(),
    grobidPaperDeadlineMs: resolveFullTextGrobidPaperDeadlineMs(),
    grobidTransientMaxRetries: GROBID_TRANSIENT_MAX_RETRIES,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...(options.deps || {}),
  }
  const deps = isPdfAcquisitionDiagEnabled()
    ? {
        ...baseDeps,
        fetchBinary: wrapFetchBinaryForDiag(baseDeps.fetchBinary),
      }
    : baseDeps

  const maxPapers = resolveFullTextMaxPapers()
  const fullTextTopK = Math.min(resolveFullTextTopK(), maxPapers)
  const allPapers = evidencePackage?.papers || []
  const selectedPapers = selectAnalystPapers(allPapers, maxPapers)
  const grobidPapers = selectedPapers.slice(0, fullTextTopK)
  const researchQuestion =
    options.researchQuestion ||
    evidencePackage?.researchQuestion ||
    evidencePackage?.planSummary?.objective ||
    ''

  let sessionDocuments = []
  try {
    sessionDocuments = await deps.listSessionDocuments(userId, sessionId)
  } catch {
    sessionDocuments = []
  }

  /** @type {object[]} */
  const extractedEvidenceItems = []
  /** @type {Map<string, string>} */
  const evidenceIdToPaperId = new Map()
  /** @type {Record<string, string>} */
  const paperEvidenceLevels = {}
  /** @type {Record<string, string>} */
  const paperFallbackReasons = {}
  /** @type {object[]} */
  const paperOutcomes = []

  seedPriorAcquiredEvidence(
    evidencePackage,
    extractedEvidenceItems,
    evidenceIdToPaperId,
    paperEvidenceLevels,
  )

  const seededEvidenceItems = [...extractedEvidenceItems]
  const concurrency = resolveFullTextConcurrency()
  let peakActiveAcquisitions = 0
  let activeAcquisitions = 0

  const paperJobs = grobidPapers.map((paper, index) => ({
    index,
    paper,
    paperId: String(paper.paperId),
    paperIndex:
      selectedPapers.findIndex((row) => String(row.paperId) === String(paper.paperId)) +
      1,
  }))

  const orderedPaperResults = new Array(paperJobs.length).fill(null)
  const pendingAcquisitionJobs = []

  for (const job of paperJobs) {
    if (paperHasReusableFullText(evidencePackage, job.paperId)) {
      const priorItems = seededEvidenceItems.filter(
        (item) =>
          String(item.paperId) === job.paperId &&
          normalizeEvidenceLevel(item.evidenceLevel) === EVIDENCE_LEVEL.FULL_TEXT,
      )
      if (priorItems.length > 0) {
        const outcome = stampAcquisitionOutcomeDiagnostics({
          paperId: job.paperId,
          status: 'full_text',
          reason: 'prior_acquisition',
          fallbackReason: null,
          evidenceLevel: EVIDENCE_LEVEL.FULL_TEXT,
          itemCount: priorItems.length,
          pdfUrlsTried: [],
          pdfUrlSelected: job.paper.pdfUrlSelected || null,
          pdfFetchAttempts: [],
          grobidAttempted: false,
          skippedAcquisition: true,
          attempts: 0,
          queueWaitMs: null,
          processingMs: null,
          totalElapsedMs: null,
          paperDeadlineMs: null,
        })
        logPdfPaperOutcome(outcome)
        orderedPaperResults[job.index] = {
          paperId: job.paperId,
          outcome,
          evidenceItems: [],
          evidenceIdToPaperId: {},
          paperEvidenceLevel: EVIDENCE_LEVEL.FULL_TEXT,
          paperFallbackReason: null,
        }
        continue
      }
    }
    pendingAcquisitionJobs.push(job)
  }

  const { results: acquiredSlots, peakActive } = await runWithBoundedConcurrency(
    pendingAcquisitionJobs,
    concurrency,
    async (job) => {
      activeAcquisitions += 1
      peakActiveAcquisitions = Math.max(peakActiveAcquisitions, activeAcquisitions)
      try {
        const result = await acquireFullTextForOnePaper({
          paper: job.paper,
          paperId: job.paperId,
          paperIndex: job.paperIndex,
          userId,
          sessionId,
          sessionDocuments,
          evidencePackage,
          deps,
        })
        logPdfPaperOutcome(result.outcome)
        return { index: job.index, result }
      } catch (error) {
        const reason = error?.message || 'acquisition_failed'
        const fallback = buildAbstractFallbackItems(job.paper, job.paperIndex, {
          reason,
        })
        const outcome = stampAcquisitionOutcomeDiagnostics({
          paperId: job.paperId,
          status: 'fallback',
          reason,
          fallbackReason: reason,
          evidenceLevel: fallback[0]?.evidenceLevel || EVIDENCE_LEVEL.ABSTRACT,
          itemCount: fallback.length,
          grobidAttempted: false,
          attempts: 0,
          queueWaitMs: null,
          processingMs: null,
        })
        logPdfPaperOutcome(outcome)
        return {
          index: job.index,
          result: {
            paperId: job.paperId,
            outcome,
            evidenceItems: fallback,
            evidenceIdToPaperId: Object.fromEntries(
              fallback.map((item) => [String(item.evidenceId), job.paperId]),
            ),
            paperEvidenceLevel:
              fallback[0]?.evidenceLevel || EVIDENCE_LEVEL.ABSTRACT,
            paperFallbackReason: reason,
          },
        }
      } finally {
        activeAcquisitions -= 1
      }
    },
  )

  peakActiveAcquisitions = Math.max(peakActiveAcquisitions, peakActive)

  for (const slot of acquiredSlots) {
    if (!slot || slot.error) continue
    orderedPaperResults[slot.index] = slot.result
  }

  for (const result of orderedPaperResults) {
    if (!result) continue
    for (const item of result.evidenceItems) {
      extractedEvidenceItems.push(item)
      evidenceIdToPaperId.set(String(item.evidenceId), result.paperId)
    }
    for (const [evidenceId, pid] of Object.entries(result.evidenceIdToPaperId || {})) {
      if (!evidenceIdToPaperId.has(evidenceId)) {
        evidenceIdToPaperId.set(evidenceId, String(pid))
      }
    }
    if (result.paperEvidenceLevel) {
      paperEvidenceLevels[result.paperId] = result.paperEvidenceLevel
    }
    if (result.paperFallbackReason) {
      paperFallbackReasons[result.paperId] = result.paperFallbackReason
    }
    paperOutcomes.push(result.outcome)
  }

  const relevantItems = selectRelevantEvidenceItems(
    extractedEvidenceItems,
    researchQuestion,
    FULL_TEXT_MAX_EVIDENCE_PER_PAPER * selectedPapers.length,
  )

  const enrichedPapers = allPapers.map((paper) => {
    const pid = String(paper.paperId)
    const level = paperEvidenceLevels[pid]
    const sampleItem =
      pickPrimaryEvidenceItem(relevantItems, pid) ||
      pickPrimaryEvidenceItem(extractedEvidenceItems, pid)
    const location = sampleItem
      ? buildEvidenceLocationFromItem(sampleItem)
      : paper.evidenceLocation || null

    return {
      ...paper,
      evidenceLevel: level || paper.evidenceLevel || null,
      evidenceSourceType: sampleItem?.sourceType || paper.evidenceSourceType || null,
      evidenceAvailability: sampleItem?.availability || paper.evidenceAvailability || null,
      fallbackReason: paperFallbackReasons[pid] || paper.fallbackReason || null,
      evidenceLocation: location,
    }
  })

  const queueStats = deps.getGrobidQueueStats?.() || null

  const stats = {
    acquisitionPhase: options.acquisitionPhase || null,
    papersSelected: selectedPapers.length,
    fullTextMaxPapers: maxPapers,
    fullTextTopK,
    papersGrobidSelected: grobidPapers.length,
    papersRequested: grobidPapers.length,
    papersSkippedPriorFullText: paperOutcomes.filter(
      (o) => o.skippedAcquisition === true,
    ).length,
    papersReused: paperOutcomes.filter((o) => o.skippedAcquisition === true).length,
    papersAcquired: paperOutcomes.filter(
      (o) => o.status === 'full_text' && !o.skippedAcquisition,
    ).length,
    papersFailed: paperOutcomes.filter(
      (o) => o.status === 'fallback' || o.status === 'grobid_failed',
    ).length,
    fullTextConcurrency: concurrency,
    peakActiveAcquisitions: peakActiveAcquisitions,
    papersFullText: paperOutcomes.filter((o) => o.status === 'full_text').length,
    papersFallback: paperOutcomes.filter((o) => o.status === 'fallback').length,
    papersGrobidFailed: paperOutcomes.filter((o) => o.status === 'grobid_failed')
      .length,
    papersGrobidAttempted: paperOutcomes.filter((o) => o.grobidAttempted).length,
    evidenceItemsExtracted: extractedEvidenceItems.length,
    evidenceItemsSelected: relevantItems.length,
    grobidConfigured: Boolean(deps.grobidBaseUrl),
    grobidRequestTimeoutMs: deps.grobidRequestTimeoutMs,
    grobidPaperDeadlineMs: deps.grobidPaperDeadlineMs,
    grobidQueueMaxDepth: queueStats?.maxObservedDepth ?? null,
    candidatesGenerated: paperOutcomes.reduce(
      (sum, row) => sum + Number(row.candidatesGenerated || 0),
      0,
    ),
    candidatesAttempted: paperOutcomes.reduce(
      (sum, row) => sum + Number(row.candidatesAttempted || 0),
      0,
    ),
    candidatesFailed: paperOutcomes.reduce(
      (sum, row) => sum + Number(row.candidatesFailed || 0),
      0,
    ),
    successfulPdfCandidates: paperOutcomes
      .map((row) => row.successfulPdfCandidate)
      .filter(Boolean),
  }

  return {
    enrichedPapers,
    extractedEvidenceItems: relevantItems,
    allExtractedEvidenceItems: extractedEvidenceItems,
    evidenceIdToPaperId: Object.fromEntries(evidenceIdToPaperId),
    paperEvidenceLevels,
    paperFallbackReasons,
    stats,
    paperOutcomes,
  }
}

/**
 * Attach acquisition output onto an EvidencePackage (immutable spread).
 *
 * @param {object} evidencePackage
 * @param {object} acquisition
 * @returns {object}
 */
export function attachAcquisitionToEvidencePackage(evidencePackage, acquisition) {
  const prior = evidencePackage || {}
  const mergedAllItems = mergeEvidenceItemsById(
    collectPackageEvidenceItems(prior),
    acquisition.allExtractedEvidenceItems || [],
  )
  const mergedPaperOutcomes = mergeAcquisitionPaperOutcomes(
    prior.fullTextAcquisition?.paperOutcomes,
    acquisition.paperOutcomes,
  )
  const mergedPaperEvidenceLevels = { ...(prior.paperEvidenceLevels || {}) }
  for (const [paperId, level] of Object.entries(acquisition.paperEvidenceLevels || {})) {
    const pid = String(paperId)
    const incoming = normalizeEvidenceLevel(level)
    const current = mergedPaperEvidenceLevels[pid]
    if (!current) {
      mergedPaperEvidenceLevels[pid] = incoming
      continue
    }
    const normalized = normalizeEvidenceLevel(current)
    mergedPaperEvidenceLevels[pid] =
      evidenceLevelRank(normalized) >= evidenceLevelRank(incoming)
        ? normalized
        : incoming
  }

  return {
    ...prior,
    papers: acquisition.enrichedPapers,
    extractedEvidenceItems: acquisition.extractedEvidenceItems,
    allExtractedEvidenceItems: mergedAllItems,
    evidenceIdToPaperId: {
      ...(prior.evidenceIdToPaperId || {}),
      ...acquisition.evidenceIdToPaperId,
    },
    paperEvidenceLevels: mergedPaperEvidenceLevels,
    paperFallbackReasons: {
      ...(prior.paperFallbackReasons || {}),
      ...acquisition.paperFallbackReasons,
    },
    fullTextAcquisition: {
      stats: {
        ...(prior.fullTextAcquisition?.stats || {}),
        ...acquisition.stats,
      },
      paperOutcomes: mergedPaperOutcomes,
    },
  }
}

export default {
  isPdfAcquisitionDiagEnabled,
  resolvePdfUrlsForPaper,
  resolveFullTextMaxPapers,
  resolveFullTextTopK,
  resolveFullTextConcurrencyLimit,
  resolveFullTextGrobidRequestTimeoutMs,
  resolveFullTextGrobidPaperDeadlineMs,
  paperHasSuccessfulFullText,
  paperHasReusableFullText,
  isTransientGrobidError,
  selectRelevantEvidenceItems,
  acquireFullTextEvidence,
  attachAcquisitionToEvidencePackage,
}
