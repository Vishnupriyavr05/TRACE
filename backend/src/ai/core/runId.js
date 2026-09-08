/**
 * @fileoverview Lightweight run identity helpers (no AgentMemory collection).
 */
import crypto from 'crypto'

/**
 * @returns {string}
 */
export function createRunId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `run_${crypto.randomBytes(16).toString('hex')}`
}

export default { createRunId }
