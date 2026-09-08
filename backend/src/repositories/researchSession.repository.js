/**
 * @fileoverview ResearchSession repository — sole DB access for workspace shells.
 * No business logic (ownership checks, soft-delete policy, HTTP).
 */
import ResearchSession from '../models/researchSession.model.js'

/**
 * Insert a new research session document.
 *
 * @param {object} sessionData
 * @returns {Promise<object>}
 */
export async function createSession(sessionData) {
  const session = await ResearchSession.create(sessionData)
  return session.toObject()
}

/**
 * Find a session by id.
 *
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function getSessionById(sessionId) {
  return ResearchSession.findById(sessionId).lean().exec()
}

/**
 * List sessions for a user with optional filters and pagination.
 *
 * @param {string} userId
 * @param {{
 *   filter?: object,
 *   sort?: object,
 *   skip?: number,
 *   limit?: number,
 * }} [options]
 * @returns {Promise<{ sessions: object[], total: number }>}
 */
export async function getUserSessions(userId, options = {}) {
  const {
    filter = {},
    sort = { updatedAt: -1 },
    skip = 0,
    limit = 20,
  } = options

  const query = { userId, ...filter }

  const [sessions, total] = await Promise.all([
    ResearchSession.find(query).sort(sort).skip(skip).limit(limit).lean().exec(),
    ResearchSession.countDocuments(query).exec(),
  ])

  return { sessions, total }
}

/**
 * Update a session by id.
 *
 * @param {string} sessionId
 * @param {object} updates
 * @returns {Promise<object|null>}
 */
export async function updateSession(sessionId, updates) {
  return ResearchSession.findByIdAndUpdate(sessionId, updates, {
    new: true,
    runValidators: true,
  })
    .lean()
    .exec()
}

/**
 * Hard-delete a session by id (prefer soft-archive via service).
 *
 * @param {string} sessionId
 * @returns {Promise<boolean>}
 */
export async function deleteSession(sessionId) {
  const result = await ResearchSession.findByIdAndDelete(sessionId).exec()
  return Boolean(result)
}

/**
 * Set pin state for a session.
 *
 * @param {string} sessionId
 * @param {boolean} isPinned
 * @returns {Promise<object|null>}
 */
export async function pinSession(sessionId, isPinned) {
  return updateSession(sessionId, { isPinned })
}

/**
 * Set archive state for a session.
 *
 * @param {string} sessionId
 * @param {{ isArchived: boolean, status?: string, isPinned?: boolean }} archiveUpdate
 * @returns {Promise<object|null>}
 */
export async function archiveSession(sessionId, archiveUpdate) {
  return updateSession(sessionId, archiveUpdate)
}

/**
 * Search / filter sessions for a user (text + field filters).
 *
 * @param {string} userId
 * @param {{
 *   search?: string,
 *   filter?: object,
 *   sort?: object,
 *   skip?: number,
 *   limit?: number,
 * }} [options]
 * @returns {Promise<{ sessions: object[], total: number }>}
 */
export async function searchSessions(userId, options = {}) {
  const {
    search,
    filter = {},
    sort = { updatedAt: -1 },
    skip = 0,
    limit = 20,
  } = options

  const query = { userId, ...filter }

  if (search && search.trim()) {
    const term = search.trim()
    query.$or = [
      { sessionTitle: { $regex: term, $options: 'i' } },
      { researchQuery: { $regex: term, $options: 'i' } },
      { domain: { $regex: term, $options: 'i' } },
    ]
  }

  const [sessions, total] = await Promise.all([
    ResearchSession.find(query).sort(sort).skip(skip).limit(limit).lean().exec(),
    ResearchSession.countDocuments(query).exec(),
  ])

  return { sessions, total }
}

/**
 * Find a non-archived session owned by user with the same title (case-insensitive).
 *
 * @param {string} userId
 * @param {string} sessionTitle
 * @param {string} [excludeSessionId]
 * @returns {Promise<object|null>}
 */
export async function findActiveByTitle(userId, sessionTitle, excludeSessionId) {
  const query = {
    userId,
    isArchived: false,
    sessionTitle: {
      $regex: `^${escapeRegex(sessionTitle.trim())}$`,
      $options: 'i',
    },
  }

  if (excludeSessionId) {
    query._id = { $ne: excludeSessionId }
  }

  return ResearchSession.findOne(query).lean().exec()
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
