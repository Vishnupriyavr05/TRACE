/**
 * @fileoverview ResearchSession service — workspace shell business logic.
 * Ownership, soft-archive, search filters, lastOpenedAt. No Mongo access.
 */
import mongoose from 'mongoose'
import * as sessionRepository from '../repositories/researchSession.repository.js'
import { AppError } from '../utils/AppError.js'

/**
 * @param {string} sessionId
 */
function assertValidObjectId(sessionId) {
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new AppError('Invalid session id', 400)
  }
}

/**
 * Ensure the session exists and belongs to the authenticated user.
 *
 * @param {object|null} session
 * @param {string} userId
 * @returns {object}
 */
function assertOwnedSession(session, userId) {
  if (!session) {
    throw new AppError('Research session not found', 404)
  }
  if (String(session.userId) !== String(userId)) {
    throw new AppError('Research session not found', 404)
  }
  return session
}

/**
 * Create a new research workspace shell for the user.
 *
 * @param {string} userId
 * @param {object} input
 * @returns {Promise<object>}
 */
export async function createSession(userId, input) {
  const duplicate = await sessionRepository.findActiveByTitle(
    userId,
    input.sessionTitle
  )
  if (duplicate) {
    throw new AppError(
      'An active session with this title already exists',
      409
    )
  }

  const isArchived = input.status === 'ARCHIVED' || Boolean(input.isArchived)

  return sessionRepository.createSession({
    ...input,
    userId,
    isArchived,
    isPinned: isArchived ? false : Boolean(input.isPinned),
    status: isArchived ? 'ARCHIVED' : input.status || 'ACTIVE',
    lastOpenedAt: new Date(),
  })
}

/**
 * List / search the authenticated user's sessions.
 *
 * @param {string} userId
 * @param {{ search?: string, status?: string, pinned?: boolean, page: number, limit: number }} query
 * @returns {Promise<{ sessions: object[], pagination: object }>}
 */
export async function listSessions(userId, query) {
  const { search, status, pinned, page, limit } = query
  const filter = {}

  // Soft-delete: hide archived by default unless status=ARCHIVED is requested
  if (status === 'ARCHIVED') {
    filter.isArchived = true
    filter.status = 'ARCHIVED'
  } else if (status) {
    filter.status = status
    filter.isArchived = false
  } else {
    filter.isArchived = false
  }

  if (typeof pinned === 'boolean') {
    filter.isPinned = pinned
  }

  const skip = (page - 1) * limit
  const sort = { isPinned: -1, updatedAt: -1 }

  const { sessions, total } = search
    ? await sessionRepository.searchSessions(userId, {
        search,
        filter,
        sort,
        skip,
        limit,
      })
    : await sessionRepository.getUserSessions(userId, {
        filter,
        sort,
        skip,
        limit,
      })

  return {
    sessions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  }
}

/**
 * Verify session exists and belongs to user without updating lastOpenedAt.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {{ allowArchived?: boolean }} [options]
 * @returns {Promise<object>}
 */
export async function requireOwnedSession(
  userId,
  sessionId,
  options = {}
) {
  assertValidObjectId(sessionId)
  const session = assertOwnedSession(
    await sessionRepository.getSessionById(sessionId),
    userId
  )

  if (!options.allowArchived && session.isArchived) {
    throw new AppError('Research session is archived', 410)
  }

  return session
}

/**
 * Open / restore a session — updates lastOpenedAt.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @returns {Promise<object>}
 */
export async function getSession(userId, sessionId) {
  const existing = await requireOwnedSession(userId, sessionId)

  const updated = await sessionRepository.updateSession(sessionId, {
    lastOpenedAt: new Date(),
  })

  return updated || existing
}

/**
 * Update workspace metadata (not research content).
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {object} updates
 * @returns {Promise<object>}
 */
export async function updateSession(userId, sessionId, updates) {
  assertValidObjectId(sessionId)
  const existing = assertOwnedSession(
    await sessionRepository.getSessionById(sessionId),
    userId
  )

  if (existing.isArchived) {
    throw new AppError('Cannot update an archived session', 400)
  }

  if (updates.sessionTitle) {
    const duplicate = await sessionRepository.findActiveByTitle(
      userId,
      updates.sessionTitle,
      sessionId
    )
    if (duplicate) {
      throw new AppError(
        'An active session with this title already exists',
        409
      )
    }
  }

  const payload = { ...updates }

  if (payload.workspaceState) {
    payload.workspaceState = {
      ...(existing.workspaceState || {}),
      ...payload.workspaceState,
    }
  }

  if (payload.status === 'ARCHIVED') {
    payload.isArchived = true
    payload.isPinned = false
  }

  const updated = await sessionRepository.updateSession(sessionId, payload)
  if (!updated) {
    throw new AppError('Research session not found', 404)
  }
  return updated
}

/**
 * Soft-delete a session (archive).
 *
 * @param {string} userId
 * @param {string} sessionId
 * @returns {Promise<object>}
 */
export async function deleteSession(userId, sessionId) {
  assertValidObjectId(sessionId)
  assertOwnedSession(await sessionRepository.getSessionById(sessionId), userId)

  const updated = await sessionRepository.archiveSession(sessionId, {
    isArchived: true,
    isPinned: false,
    status: 'ARCHIVED',
  })

  if (!updated) {
    throw new AppError('Research session not found', 404)
  }
  return updated
}

/**
 * Pin or unpin a session.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {{ toggle?: boolean, isPinned?: boolean }} options
 * @returns {Promise<object>}
 */
export async function pinSession(userId, sessionId, options = {}) {
  assertValidObjectId(sessionId)
  const existing = assertOwnedSession(
    await sessionRepository.getSessionById(sessionId),
    userId
  )

  if (existing.isArchived) {
    throw new AppError('Cannot pin an archived session', 400)
  }

  const isPinned = options.toggle
    ? !existing.isPinned
    : Boolean(options.isPinned)

  const updated = await sessionRepository.pinSession(sessionId, isPinned)
  if (!updated) {
    throw new AppError('Research session not found', 404)
  }
  return updated
}

/**
 * Archive (or unarchive) a session.
 *
 * @param {string} userId
 * @param {string} sessionId
 * @param {{ isArchived?: boolean }} [options]
 * @returns {Promise<object>}
 */
export async function archiveSession(userId, sessionId, options = {}) {
  assertValidObjectId(sessionId)
  assertOwnedSession(await sessionRepository.getSessionById(sessionId), userId)

  const shouldArchive =
    options.isArchived === undefined ? true : Boolean(options.isArchived)

  if (shouldArchive) {
    const updated = await sessionRepository.archiveSession(sessionId, {
      isArchived: true,
      isPinned: false,
      status: 'ARCHIVED',
    })
    if (!updated) {
      throw new AppError('Research session not found', 404)
    }
    return updated
  }

  const updated = await sessionRepository.archiveSession(sessionId, {
    isArchived: false,
    status: 'ACTIVE',
  })

  if (!updated) {
    throw new AppError('Research session not found', 404)
  }
  return updated
}
