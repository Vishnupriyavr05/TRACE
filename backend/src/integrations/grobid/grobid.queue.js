/**
 * @fileoverview Process-wide GROBID request queue (concurrency=1).
 * Serializes PDF processing so GROBID is not saturated by overlapping POSTs.
 */

/** @type {Promise<void>} */
let tail = Promise.resolve()

/** @type {number} */
let activeCount = 0

/** @type {number} */
let pendingCount = 0

/** @type {number} */
let maxObservedDepth = 0

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<{ result: T, queueWaitMs: number, processingMs: number }>}
 */
export async function enqueueGrobidWork(fn) {
  const enqueueAt = Date.now()
  pendingCount += 1
  maxObservedDepth = Math.max(maxObservedDepth, pendingCount + activeCount)

  const run = async () => {
    pendingCount = Math.max(0, pendingCount - 1)
    const queueWaitMs = Date.now() - enqueueAt
    const start = Date.now()
    activeCount += 1
    try {
      const result = await fn()
      return { result, queueWaitMs, processingMs: Date.now() - start }
    } finally {
      activeCount = Math.max(0, activeCount - 1)
    }
  }

  const task = tail.then(run, run)
  tail = task.then(
    () => {},
    () => {},
  )
  return task
}

/**
 * @returns {{ activeCount: number, pendingCount: number, maxObservedDepth: number }}
 */
export function getGrobidQueueStats() {
  return {
    activeCount,
    pendingCount,
    maxObservedDepth,
  }
}

/** @internal Reset queue state between offline tests. */
export function _resetGrobidQueueForTests() {
  tail = Promise.resolve()
  activeCount = 0
  pendingCount = 0
  maxObservedDepth = 0
}

export default {
  enqueueGrobidWork,
  getGrobidQueueStats,
  _resetGrobidQueueForTests,
}
