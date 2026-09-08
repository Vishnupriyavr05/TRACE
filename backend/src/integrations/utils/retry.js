/**
 * @fileoverview Generic retry scaffolding for research-source connectors.
 * Exponential backoff / jitter will be added when HTTP clients are wired.
 */

/**
 * @typedef {object} RetryOptions
 * @property {number} [retries=0] Maximum retry attempts after the first try
 * @property {number} [delayMs=0] Fixed delay between attempts (ms) — placeholder
 * @property {(error: unknown, attempt: number) => boolean} [shouldRetry] Predicate for retrying
 */

/**
 * Execute an async function with optional retries.
 * Currently performs a single attempt unless `retries` > 0 with a fixed delay stub.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {RetryOptions} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, options = {}) {
  const {
    retries = 0,
    delayMs = 0,
    shouldRetry = () => true,
  } = options

  let attempt = 0
  let lastError

  while (attempt <= retries) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt >= retries || !shouldRetry(error, attempt)) {
        throw error
      }
      // Placeholder: fixed delay only. Exponential backoff intentionally deferred.
      if (delayMs > 0) {
        await sleep(delayMs)
      }
      attempt += 1
    }
  }

  throw lastError
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
