/**
 * @fileoverview Paper service — business logic for session-scoped papers.
 * Discovery and other modules must call this layer (not the repository).
 */
import * as paperRepository from '../repositories/paper.repository.js'
import { AppError } from '../utils/AppError.js'
import { preferPrimaryPdfUrl } from '../integrations/utils/pdfCandidateUrls.js'

/**
 * Map a connector PaperDTO into a Mongo paper document payload.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {import('../integrations/mappers/paper.mapper.js').PaperDTO} dto
 * @param {number} rank
 * @returns {object}
 */
export function mapDtoToPaperDocument(userId, sessionId, dto, rank) {
  const badges = []
  if (dto.openAccess) badges.push('Open Access')
  if (dto.peerReviewed) badges.push('Peer Reviewed')

  const source = normalizePersistedSource(dto.source)
  const pdfCandidates = Array.isArray(dto.pdfCandidates) ? dto.pdfCandidates : []
  const primaryPdfUrl = preferPrimaryPdfUrl(pdfCandidates) || dto.pdfUrl || null

  return {
    sessionId,
    userId,
    rank,
    title: dto.title || 'Untitled',
    authors: Array.isArray(dto.authors) ? dto.authors : [],
    year: dto.publicationYear ?? null,
    venue: dto.venue || '',
    abstract: dto.abstract || '',
    url: primaryPdfUrl,
    pdfCandidates,
    fullTextSources: Array.isArray(dto.fullTextSources) ? dto.fullTextSources : [],
    openAlexLocations: Array.isArray(dto.openAlexLocations) ? dto.openAlexLocations : [],
    citationCount: dto.citationCount ?? 0,
    keywords: Array.isArray(dto.keywords) ? dto.keywords : [],
    paperType: dto.paperType || 'other',
    source,
    sources: Array.isArray(dto.sources) ? dto.sources : [],
    discoveryMethod: dto.discoveryMethod || null,
    badges,
    externalIds: {
      doi: dto.doi || null,
      openAlexId: dto.externalIds?.openAlexId || null,
      semanticScholarId: dto.externalIds?.semanticScholarId || null,
      arxivId: dto.externalIds?.arxivId || null,
    },
    integrity: {
      peerReviewed: dto.peerReviewed,
      openAccess: dto.openAccess,
      retractionStatus: 'none',
      correctionStatus: 'none',
      venueQuality: null,
    },
  }
}

/**
 * @param {unknown} source
 * @returns {string}
 */
function normalizePersistedSource(source) {
  const allowed = new Set([
    'openalex',
    'semantic_scholar',
    'crossref',
    'core',
    'upload',
    'manual',
    'other',
  ])
  if (typeof source === 'string' && allowed.has(source)) return source
  return 'other'
}

/**
 * Persist discovered / normalized papers for a session.
 * Upserts by (sessionId, doi) when DOI is present; otherwise creates.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {import('../integrations/mappers/paper.mapper.js').PaperDTO[]} paperDtos
 * @returns {Promise<object[]>}
 */
export async function saveDiscoveredPapers(userId, sessionId, paperDtos = []) {
  if (!userId || !sessionId) {
    throw new AppError('userId and sessionId are required to save papers', 400)
  }

  if (!Array.isArray(paperDtos) || paperDtos.length === 0) {
    return []
  }

  const saved = []
  let rank = 1

  for (const dto of paperDtos) {
    if (!dto?.title || !String(dto.title).trim()) {
      continue
    }

    const payload = mapDtoToPaperDocument(userId, sessionId, dto, rank)

    let paper
    if (payload.externalIds.doi) {
      paper = await paperRepository.upsertBySessionFilter(
        {
          sessionId,
          'externalIds.doi': payload.externalIds.doi,
        },
        payload
      )
    } else {
      paper = await paperRepository.create(payload)
    }

    if (paper) {
      saved.push(paper)
      rank += 1
    }
  }

  return saved
}

/**
 * List papers for a session.
 *
 * @param {string} sessionId
 * @returns {Promise<object[]>}
 */
export async function listSessionPapers(sessionId) {
  return paperRepository.listBySessionId(sessionId)
}

/**
 * Get a paper by id.
 *
 * @param {string} paperId
 * @returns {Promise<object|null>}
 */
export async function getPaperById(paperId) {
  return paperRepository.findById(paperId)
}
