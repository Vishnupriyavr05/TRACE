/**
 * @fileoverview Promote session uploads into the TRACE research paper corpus.
 */
import fs from 'fs/promises'
import path from 'path'
import { extractPdfMetadata, fallbackTitleFromFilename } from '../integrations/utils/pdfMetadata.js'
import { isValidPdfBuffer } from '../integrations/utils/pdfValidate.js'
import * as documentRepository from '../repositories/researchDocument.repository.js'
import * as paperRepository from '../repositories/paper.repository.js'
import { AppError } from '../utils/AppError.js'

export function resolveDocumentAbsolutePath(document) {
  if (!document?.storagePath) return ''
  return path.resolve(process.cwd(), document.storagePath)
}

export function mapUploadPaperToEvidencePackageEntry(paper) {
  const paperId = String(paper._id || paper.id || paper.paperId || '')
  const uploadDocumentId = paper.externalIds?.uploadDocumentId || null
  const absolutePath = paper.url?.startsWith('file://')
    ? paper.url.replace(/^file:\/\//i, '')
    : null
  const localPdfUrl = absolutePath || paper.url || null
  return {
    paperId,
    source: 'upload',
    discoveryMethod: 'user_upload',
    title: paper.title || '',
    authors: Array.isArray(paper.authors) ? paper.authors : [],
    abstract: paper.abstract || '',
    venue: paper.venue || '',
    year: paper.year ?? null,
    doi: paper.externalIds?.doi || null,
    keywords: Array.isArray(paper.keywords) ? paper.keywords : [],
    citationCount: paper.citationCount ?? 0,
    url: localPdfUrl,
    pdfUrl: localPdfUrl,
    pdfCandidates: Array.isArray(paper.pdfCandidates) ? paper.pdfCandidates : [],
    fullTextSources: Array.isArray(paper.fullTextSources) ? paper.fullTextSources : [],
    openAlexLocations: Array.isArray(paper.openAlexLocations) ? paper.openAlexLocations : [],
    openAccess: paper.integrity?.openAccess ?? true,
    integrity: paper.integrity || {
      peerReviewed: null,
      openAccess: true,
      retractionStatus: 'none',
      correctionStatus: 'none',
      venueQuality: null,
    },
    externalIds: { ...(paper.externalIds || {}), uploadDocumentId },
    uploadDocumentId,
    relevance: typeof paper.relevance === 'number' ? paper.relevance : 0.95,
    matchedQueries: ['user_upload'],
    provenance: {
      sessionId: String(paper.sessionId || ''),
      paperId,
      source: 'upload',
      providers: ['upload'],
      discoveryQueries: ['user_upload'],
      origin: 'USER_UPLOAD',
      uploadDocumentId,
      nodeId: null,
    },
  }
}

export async function syncUploadedDocumentToPaper(userId, sessionId, document, pdfBuffer = null) {
  const documentId = String(document._id || document.id || '')
  if (!documentId) throw new AppError('Uploaded document id is required', 400)

  const existing = await paperRepository.findBySessionAndUploadDocumentId(sessionId, documentId)
  if (existing) return existing

  let buffer = pdfBuffer
  if (!buffer) {
    const absolutePath = resolveDocumentAbsolutePath(document)
    if (absolutePath) {
      try { buffer = await fs.readFile(absolutePath) } catch { buffer = null }
    }
  }

  const metadata = buffer && isValidPdfBuffer(buffer)
    ? extractPdfMetadata(buffer, { originalName: document.originalName })
    : { title: fallbackTitleFromFilename(document.originalName), authors: [], year: null, doi: null }

  const absolutePath = resolveDocumentAbsolutePath(document)
  const localPdfUrl = absolutePath ? `file://${absolutePath.replace(/\\/g, '/')}` : null

  const paperData = {
    sessionId,
    userId,
    rank: null,
    title: metadata.title || fallbackTitleFromFilename(document.originalName),
    authors: metadata.authors || [],
    year: metadata.year ?? null,
    venue: '',
    abstract: '',
    url: localPdfUrl,
    pdfCandidates: localPdfUrl ? [localPdfUrl] : [],
    fullTextSources: localPdfUrl ? [{ type: 'pdf', url: localPdfUrl, source: 'upload' }] : [],
    openAlexLocations: [],
    citationCount: 0,
    keywords: [],
    paperType: 'other',
    source: 'upload',
    sources: [{ provider: 'upload', contributed: ['user_upload'] }],
    discoveryMethod: 'user_upload',
    badges: ['User Upload'],
    externalIds: {
      doi: metadata.doi || null,
      openAlexId: null,
      semanticScholarId: null,
      arxivId: null,
      uploadDocumentId: documentId,
    },
    integrity: {
      peerReviewed: null,
      openAccess: true,
      retractionStatus: 'none',
      correctionStatus: 'none',
      venueQuality: null,
    },
    raw: {
      uploadDocumentId: documentId,
      originalName: document.originalName,
      checksum: document.checksum || null,
    },
  }

  const paper = await paperRepository.upsertBySessionFilter(
    { sessionId, 'externalIds.uploadDocumentId': documentId },
    paperData,
  )

  await documentRepository.updateLinkedPaperId(documentId, paper._id || paper.id)
  return paper
}

export async function ensureSessionUploadsInCorpus(userId, sessionId) {
  const documents = await documentRepository.getDocumentsBySession(sessionId, { includeStoragePath: true })
  const pdfDocuments = documents.filter((doc) =>
    String(doc.documentType || '').toUpperCase() === 'PDF' ||
    String(doc.extension || '').toLowerCase() === 'pdf' ||
    String(doc.mimeType || '').toLowerCase().includes('pdf'),
  )

  const papers = []
  for (const document of pdfDocuments) {
    if (String(document.userId) !== String(userId)) continue
    papers.push(await syncUploadedDocumentToPaper(userId, sessionId, document))
  }
  return papers
}

export default {
  ensureSessionUploadsInCorpus,
  syncUploadedDocumentToPaper,
  mapUploadPaperToEvidencePackageEntry,
  resolveDocumentAbsolutePath,
}
