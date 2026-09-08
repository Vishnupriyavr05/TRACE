/**
 * @fileoverview ResearchDocument service — ownership, checksum, storage I/O.
 * No parsing, OCR, embeddings, or AI.
 */
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import crypto from 'crypto'
import mongoose from 'mongoose'
import * as documentRepository from '../repositories/researchDocument.repository.js'
import * as sessionRepository from '../repositories/researchSession.repository.js'
import {
  UPLOADS_ROOT,
  ensureDirectory,
  resolveDocumentType,
} from '../config/multer/multer.config.js'
import { AppError } from '../utils/AppError.js'
import { syncUploadedDocumentToPaper } from './uploadedPaperIntegration.service.js'

/**
 * @param {string} id
 * @param {string} label
 */
function assertValidObjectId(id, label = 'id') {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${label}`, 400)
  }
}

/**
 * Strip filesystem path from API payloads.
 *
 * @param {object|null} doc
 * @returns {object|null}
 */
function toPublicDocument(doc) {
  if (!doc) return null
  const { storagePath, __v, ...safe } = doc
  return safe
}

/**
 * Compute SHA-256 checksum for a file on disk.
 *
 * @param {string} absolutePath
 * @returns {Promise<string>}
 */
async function computeChecksum(absolutePath) {
  const hash = crypto.createHash('sha256')
  const handle = await fs.open(absolutePath, 'r')
  try {
    const stream = handle.createReadStream()
    for await (const chunk of stream) {
      hash.update(chunk)
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

/**
 * Build absolute target path under uploads/userId/sessionId/storedName.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {string} storedName
 * @returns {{ absolutePath: string, relativePath: string }}
 */
function buildFinalStoragePaths(userId, sessionId, storedName) {
  const dir = path.join(UPLOADS_ROOT, String(userId), String(sessionId))
  ensureDirectory(dir)
  const absolutePath = path.join(dir, storedName)
  const relativePath = path
    .join('uploads', String(userId), String(sessionId), storedName)
    .replace(/\\/g, '/')
  return { absolutePath, relativePath }
}

/**
 * Safely remove a file if it exists.
 *
 * @param {string} absolutePath
 */
async function removeFileQuietly(absolutePath) {
  try {
    await fs.unlink(absolutePath)
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error
    }
  }
}

/**
 * Upload a document for an owned session.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {Express.Multer.File} file
 * @returns {Promise<object>}
 */
export async function uploadDocument(userId, sessionId, file) {
  assertValidObjectId(sessionId, 'sessionId')

  if (!file) {
    throw new AppError(
      'No file uploaded. Attach a PDF as form field "file".',
      400
    )
  }

  const session = await sessionRepository.getSessionById(sessionId)
  if (!session || String(session.userId) !== String(userId)) {
    await removeFileQuietly(file.path)
    throw new AppError('Research session not found', 404)
  }
  if (session.isArchived) {
    await removeFileQuietly(file.path)
    throw new AppError('Cannot upload to an archived session', 400)
  }

  const extension =
    path.extname(file.originalname || '').replace('.', '').toLowerCase() ||
    'pdf'
  const documentType = resolveDocumentType(file.mimetype, extension)
  const storedName = file.filename
  const { absolutePath, relativePath } = buildFinalStoragePaths(
    userId,
    sessionId,
    storedName
  )

  try {
    await fs.rename(file.path, absolutePath)
  } catch {
    await fs.copyFile(file.path, absolutePath)
    await removeFileQuietly(file.path)
  }

  let checksum
  try {
    checksum = await computeChecksum(absolutePath)
  } catch (error) {
    await removeFileQuietly(absolutePath)
    throw error
  }

  try {
    const created = await documentRepository.createDocument({
      sessionId,
      userId,
      originalName: file.originalname,
      storedName,
      mimeType: file.mimetype,
      extension,
      size: file.size,
      storagePath: relativePath,
      documentType,
      uploadSource: 'USER_UPLOAD',
      status: 'UPLOADED',
      checksum,
    })
    const paper = await syncUploadedDocumentToPaper(userId, sessionId, {
      ...created,
      storagePath: relativePath,
    })
    const publicDoc = toPublicDocument(created)
    if (paper?._id || paper?.id) {
      publicDoc.linkedPaperId = String(paper._id || paper.id)
    }
    return publicDoc
  } catch (error) {
    await removeFileQuietly(absolutePath)
    throw error
  }
}

/**
 * Get document metadata by id (owner only).
 *
 * @param {string} userId
 * @param {string} documentId
 * @returns {Promise<object>}
 */
export async function getDocument(userId, documentId) {
  assertValidObjectId(documentId, 'document id')
  const doc = await documentRepository.getDocumentById(documentId)
  if (!doc || String(doc.userId) !== String(userId)) {
    throw new AppError('Document not found', 404)
  }
  return toPublicDocument(doc)
}

/**
 * List documents for a session owned by the user.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @returns {Promise<object[]>}
 */
export async function listSessionDocuments(userId, sessionId) {
  assertValidObjectId(sessionId, 'sessionId')

  const session = await sessionRepository.getSessionById(sessionId)
  if (!session || String(session.userId) !== String(userId)) {
    throw new AppError('Research session not found', 404)
  }

  const docs = await documentRepository.getDocumentsBySession(sessionId)
  return docs.map((doc) => toPublicDocument(doc))
}

/**
 * Prepare a document download for the owner.
 *
 * @param {string} userId
 * @param {string} documentId
 * @returns {Promise<{ absolutePath: string, originalName: string, mimeType: string }>}
 */
export async function getDocumentForDownload(userId, documentId) {
  assertValidObjectId(documentId, 'document id')

  const doc = await documentRepository.getDocumentById(documentId, {
    includeStoragePath: true,
  })
  if (!doc || String(doc.userId) !== String(userId)) {
    throw new AppError('Document not found', 404)
  }

  const absolutePath = path.resolve(process.cwd(), doc.storagePath)
  if (!fsSync.existsSync(absolutePath)) {
    throw new AppError('Document file is missing from storage', 404)
  }

  return {
    absolutePath,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
  }
}

/**
 * Delete DB record and physical file (owner only).
 *
 * @param {string} userId
 * @param {string} documentId
 * @returns {Promise<object>}
 */
export async function deleteDocument(userId, documentId) {
  assertValidObjectId(documentId, 'document id')

  const existing = await documentRepository.getDocumentById(documentId, {
    includeStoragePath: true,
  })
  if (!existing || String(existing.userId) !== String(userId)) {
    throw new AppError('Document not found', 404)
  }

  const deleted = await documentRepository.deleteDocument(documentId)
  if (!deleted) {
    throw new AppError('Document not found', 404)
  }

  if (deleted.storagePath) {
    const absolutePath = path.resolve(process.cwd(), deleted.storagePath)
    await removeFileQuietly(absolutePath)
  }

  return toPublicDocument(deleted)
}
