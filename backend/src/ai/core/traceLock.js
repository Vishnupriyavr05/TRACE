/**
 * @fileoverview Per-user TRACE concurrency lock (in-process).
 * Prevents two independent LLM pipelines for the same user at once.
 */
import { AppError } from '../../utils/AppError.js'

/** @type {Map<string, { sessionId: string, runId: string, startedAt: number }>} */
const activeTraces = new Map()

/**
 * @param {string} userId
 * @param {string} sessionId
 * @param {string} runId
 */
export function acquireTraceLock(userId, sessionId, runId) {
  const key = String(userId || '')
  if (!key) {
    throw new AppError('userId is required to start TRACE', 400)
  }
  const existing = activeTraces.get(key)
  if (existing) {
    const err = new AppError(
      'A TRACE is already running for this account. Wait for it to finish before starting another.',
      409,
    )
    err.code = 'TRACE_ALREADY_RUNNING'
    err.activeTrace = {
      sessionId: existing.sessionId,
      runId: existing.runId,
      startedAt: existing.startedAt,
    }
    throw err
  }
  activeTraces.set(key, {
    sessionId: String(sessionId),
    runId: String(runId),
    startedAt: Date.now(),
  })
}

/**
 * @param {string} userId
 * @param {string} [runId] — if provided, only release matching lock
 */
export function releaseTraceLock(userId, runId) {
  const key = String(userId || '')
  const existing = activeTraces.get(key)
  if (!existing) return
  if (runId && String(existing.runId) !== String(runId)) return
  activeTraces.delete(key)
}

/**
 * @param {string} userId
 * @returns {object|null}
 */
export function getActiveTraceLock(userId) {
  return activeTraces.get(String(userId || '')) || null
}

/**
 * Test helper.
 */
export function resetTraceLocksForTests() {
  activeTraces.clear()
}

export default {
  acquireTraceLock,
  releaseTraceLock,
  getActiveTraceLock,
  resetTraceLocksForTests,
}
