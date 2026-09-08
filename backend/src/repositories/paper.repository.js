/**
 * @fileoverview Paper repository — sole DB access for paper documents.
 */
import Paper from '../models/paper.model.js'

/**
 * @param {string} paperId
 * @returns {Promise<object|null>}
 */
export async function findById(paperId) {
  return Paper.findById(paperId).lean().exec()
}

/**
 * @param {string} sessionId
 * @param {string} doi
 * @returns {Promise<object|null>}
 */
export async function findBySessionAndDoi(sessionId, doi) {
  if (!doi) return null
  return Paper.findOne({
    sessionId,
    'externalIds.doi': doi.toLowerCase().trim(),
  })
    .lean()
    .exec()
}

/**
 * @param {string} sessionId
 * @param {string} uploadDocumentId
 * @returns {Promise<object|null>}
 */
export async function findBySessionAndUploadDocumentId(
  sessionId,
  uploadDocumentId,
) {
  if (!uploadDocumentId) return null
  return Paper.findOne({
    sessionId,
    'externalIds.uploadDocumentId': String(uploadDocumentId),
  })
    .lean()
    .exec()
}

/**
 * @param {string} doi
 * @returns {Promise<object|null>}
 */
export async function findByDoi(doi) {
  if (!doi) return null
  return Paper.findOne({ 'externalIds.doi': doi.toLowerCase().trim() })
    .lean()
    .exec()
}

/**
 * @param {object} paperData
 * @returns {Promise<object>}
 */
export async function create(paperData) {
  const paper = await Paper.create(paperData)
  const plain = paper.toObject()
  delete plain.__v
  delete plain.raw
  return plain
}

/**
 * Upsert a paper for a session using DOI when available, otherwise create.
 *
 * @param {object} filter
 * @param {object} data
 * @returns {Promise<object>}
 */
export async function upsertBySessionFilter(filter, data) {
  const paper = await Paper.findOneAndUpdate(
    filter,
    { $set: data },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  )
    .lean()
    .exec()
  if (!paper) return null
  const { __v, raw, ...safe } = paper
  return safe
}

/**
 * @param {string} paperId
 * @param {object} updates
 * @returns {Promise<object|null>}
 */
export async function updateById(paperId, updates) {
  return Paper.findByIdAndUpdate(paperId, updates, {
    new: true,
    runValidators: true,
  })
    .lean()
    .exec()
}

/**
 * @param {string} sessionId
 * @returns {Promise<object[]>}
 */
export async function listBySessionId(sessionId) {
  return Paper.find({ sessionId }).sort({ rank: 1, createdAt: -1 }).lean().exec()
}

/**
 * @param {string[]} paperIds
 * @returns {Promise<object[]>}
 */
export async function findManyByIds(paperIds) {
  return Paper.find({ _id: { $in: paperIds } }).lean().exec()
}
