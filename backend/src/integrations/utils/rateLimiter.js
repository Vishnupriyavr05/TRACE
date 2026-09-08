/**
 * @fileoverview Rate-limiter scaffolding for research-source connectors.
 * No throttling logic yet — placeholder for future token-bucket / sliding-window.
 */

/**
 * @typedef {object} RateLimiterOptions
 * @property {number} [maxRequests] Max requests per window (unused placeholder)
 * @property {number} [windowMs] Window size in ms (unused placeholder)
 * @property {string} [source] Source key for per-provider buckets
 */

/**
 * Placeholder rate limiter. Always allows the call through.
 * Future: enforce per-source limits before HTTP requests.
 */
export class RateLimiter {
  /**
   * @param {RateLimiterOptions} [options]
   */
  constructor(options = {}) {
    this.maxRequests = options.maxRequests ?? null
    this.windowMs = options.windowMs ?? null
    this.source = options.source ?? 'default'
  }

  /**
   * Acquire permission to proceed. Currently a no-op that always resolves.
   *
   * @returns {Promise<void>}
   */
  async acquire() {
    // Placeholder — no rate limiting applied yet.
    return undefined
  }

  /**
   * Reset limiter state (placeholder).
   */
  reset() {
    // Placeholder
  }
}

/**
 * Create a rate limiter instance for a connector source.
 *
 * @param {RateLimiterOptions} [options]
 * @returns {RateLimiter}
 */
export function createRateLimiter(options = {}) {
  return new RateLimiter(options)
}
