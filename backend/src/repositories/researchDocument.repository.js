/**
 * @fileoverview ResearchDocument repository — DB access only.
 */
import ResearchDocument from '../models/researchDocument.model.js'

/**
 * Insert a new research document record.
 *
 * @param {object} documentData
 * @returns {Promise<object>}
 */
export async function createDocument(documentData) {
  const doc = await ResearchDocument.create(documentData)
  const plain = doc.toObject()
  delete plain.storagePath
  delete plain.__v
  return plain
}

/**
 * Find a document by id.
 *
 * @param {string} documentId
 * @param {{ includeStoragePath?: boolean }} [options]
 * @returns {Promise<object|null>}
 */
export async function getDocumentById(documentId, options = {}) {
  const query = ResearchDocument.findById(documentId)
  if (options.includeStoragePath) {
    query.select('+storagePath')
  }
  return query.lean().exec()
}

/**
 * List documents for a session (newest first).
 *
 * @param {string} sessionId
 * @returns {Promise<object[]>}
 */
export async function getDocumentsBySession(sessionId, options = {}) {
  const query = ResearchDocument.find({ sessionId }).sort({ createdAt: -1 })
  if (options.includeStoragePath) {
    query.select('+storagePath')
  }
  return query.lean().exec()
}

/**
 * @param {string} documentId
 * @param {string} paperId
 * @returns {Promise<object|null>}
 */
export async function updateLinkedPaperId(documentId, paperId) {
  return ResearchDocument.findByIdAndUpdate(
    documentId,
    { $set: { linkedPaperId: paperId } },
    { new: true, runValidators: true },
  )
    .lean()
    .exec()
}

/**
 * Delete a document record by id.
 *
 * @param {string} documentId
 * @returns {Promise<object|null>} Deleted document (with storagePath when selected)
 */
export async function deleteDocument(documentId) {
  return ResearchDocument.findByIdAndDelete(documentId)
    .select('+storagePath')
    .lean()
    .exec()
}
