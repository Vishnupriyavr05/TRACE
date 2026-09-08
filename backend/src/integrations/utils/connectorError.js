/**
 * @fileoverview Typed errors for external research-source connectors.
 * Independent of Express / Mongo / AI layers.
 */

/** @typedef {'TIMEOUT'|'RATE_LIMIT'|'INVALID_RESPONSE'|'SOURCE_UNAVAILABLE'|'NOT_IMPLEMENTED'|'UNKNOWN'} ConnectorErrorCode */

/**
 * Base error for connector framework failures.
 */
export class ConnectorError extends Error {
  /**
   * @param {string} message
   * @param {ConnectorErrorCode} code
   * @param {{ source?: string, statusCode?: number, cause?: unknown, details?: object }} [options]
   */
  constructor(message, code, options = {}) {
    super(message)
    this.name = 'ConnectorError'
    this.code = code
    this.source = options.source || null
    this.statusCode = options.statusCode || null
    this.details = options.details || null
    this.cause = options.cause
    Error.captureStackTrace?.(this, this.constructor)
  }
}

/**
 * Request timed out talking to an external source.
 */
export class ConnectorTimeoutError extends ConnectorError {
  /**
   * @param {string} message
   * @param {{ source?: string, cause?: unknown }} [options]
   */
  constructor(message = 'Research source request timed out', options = {}) {
    super(message, 'TIMEOUT', options)
    this.name = 'ConnectorTimeoutError'
  }
}

/**
 * External source rate-limited the client.
 */
export class ConnectorRateLimitError extends ConnectorError {
  /**
   * @param {string} message
   * @param {{ source?: string, statusCode?: number, cause?: unknown }} [options]
   */
  constructor(message = 'Research source rate limit exceeded', options = {}) {
    super(message, 'RATE_LIMIT', { statusCode: 429, ...options })
    this.name = 'ConnectorRateLimitError'
  }
}

/**
 * Response shape was invalid or unparseable.
 */
export class ConnectorInvalidResponseError extends ConnectorError {
  /**
   * @param {string} message
   * @param {{ source?: string, details?: object, cause?: unknown }} [options]
   */
  constructor(message = 'Invalid response from research source', options = {}) {
    super(message, 'INVALID_RESPONSE', options)
    this.name = 'ConnectorInvalidResponseError'
  }
}

/**
 * Source is unreachable or returned a service failure.
 */
export class ConnectorUnavailableError extends ConnectorError {
  /**
   * @param {string} message
   * @param {{ source?: string, statusCode?: number, cause?: unknown }} [options]
   */
  constructor(message = 'Research source is unavailable', options = {}) {
    super(message, 'SOURCE_UNAVAILABLE', options)
    this.name = 'ConnectorUnavailableError'
  }
}

/**
 * Method or provider networking is not wired yet.
 */
export class ConnectorNotImplementedError extends ConnectorError {
  /**
   * @param {string} message
   * @param {{ source?: string }} [options]
   */
  constructor(message = 'Connector method is not implemented', options = {}) {
    super(message, 'NOT_IMPLEMENTED', options)
    this.name = 'ConnectorNotImplementedError'
  }
}
