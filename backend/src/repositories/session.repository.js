/**
 * @fileoverview Compatibility re-exports for research session repository.
 * Prefer importing from `researchSession.repository.js`.
 */
export {
  createSession as create,
  getSessionById as findById,
  updateSession as updateById,
  deleteSession as deleteById,
  getUserSessions as listByUserId,
} from './researchSession.repository.js'
