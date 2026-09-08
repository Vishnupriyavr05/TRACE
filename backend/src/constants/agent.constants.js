/**
 * @fileoverview Multi-agent pipeline constants.
 *
 * Future values: agent ids/labels, stage order, timeout budgets, status enums.
 * Must mirror frontend AGENTS contract where applicable.
 */

/**
 * Ordered TRACE agent identifiers.
 *
 * @type {ReadonlyArray<{ id: string, label: string }>}
 */
export const AGENTS = Object.freeze([
  { id: 'planner', label: 'Planner' },
  { id: 'explorer', label: 'Explorer' },
  { id: 'evidence_analyst', label: 'Evidence Analyst' },
  { id: 'critic', label: 'Critic' },
  { id: 'synthesizer', label: 'Synthesizer' },
])

/**
 * @type {Readonly<Record<string, string>>}
 */
export const AGENT_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
})

/**
 * @type {Readonly<Record<string, unknown>>}
 */
export const AGENT_CONSTANTS = Object.freeze({
  // e.g. STAGE_TIMEOUT_MS, MAX_RETRIES — intentionally empty
})
