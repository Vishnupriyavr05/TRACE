/**
 * TRACE session policy — pure helpers for offline verification.
 *
 * A TRACE run must always create a fresh research session so papers,
 * reports, and graphs never mix across research questions.
 * Prior sessions remain intact for restore via the session list.
 */

/**
 * @returns {boolean} always false — TRACE never reuses an active session
 */
export function shouldReuseActiveSessionForTrace() {
  return false
}

/**
 * @param {{ activeSessionId?: string|null, newQuery?: string }} [input]
 * @returns {{ createFreshSession: true, reuseActiveSession: false }}
 */
export function resolveTraceSessionAction(input = {}) {
  void input
  return {
    createFreshSession: true,
    reuseActiveSession: false,
  }
}

export default {
  shouldReuseActiveSessionForTrace,
  resolveTraceSessionAction,
}
