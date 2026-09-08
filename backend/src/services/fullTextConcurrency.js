/**
 * @fileoverview Bounded concurrency helpers for full-text paper acquisition.
 */
import { envNumber } from '../ai/core/traceProfile.js'

const DEFAULT_FULL_TEXT_CONCURRENCY = 3

/**
 * @returns {number}
 */
export function resolveFullTextConcurrency() {
  return Math.max(1, envNumber('FULL_TEXT_CONCURRENCY', DEFAULT_FULL_TEXT_CONCURRENCY))
}

/**
 * Run async work over items with a fixed concurrency limit.
 * Results are stored in input order; one failure does not abort other tasks.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, slot: number) => Promise<R>} worker
 * @returns {Promise<{ results: R[], peakActive: number }>}
 */
export async function runWithBoundedConcurrency(items, limit, worker) {
  if (!items.length) {
    return { results: [], peakActive: 0 }
  }

  const concurrency = Math.max(1, Math.min(limit, items.length))
  /** @type {R[]} */
  const results = new Array(items.length)
  let nextSlot = 0
  let activeCount = 0
  let peakActive = 0

  return new Promise((resolve) => {
    const pump = () => {
      while (activeCount < concurrency && nextSlot < items.length) {
        const slot = nextSlot
        nextSlot += 1
        activeCount += 1
        peakActive = Math.max(peakActive, activeCount)

        Promise.resolve(worker(items[slot], slot))
          .then((value) => {
            results[slot] = value
          })
          .catch((error) => {
            results[slot] = /** @type {R} */ (/** @type {unknown} */ ({
              error,
              slot,
            }))
          })
          .finally(() => {
            activeCount -= 1
            if (nextSlot >= items.length && activeCount === 0) {
              resolve({ results, peakActive })
            } else {
              pump()
            }
          })
      }
    }

    pump()
  })
}

export default {
  resolveFullTextConcurrency,
  runWithBoundedConcurrency,
}
