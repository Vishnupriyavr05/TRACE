/**
 * @fileoverview Operational HTTP error for TRACE controllers and services.
 */

/**
 * Application error with an HTTP status code.
 * Passed to the centralized error middleware.
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode=500]
   * @param {string[]} [errors]
   */
  constructor(message, statusCode = 500, errors = undefined) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.errors = errors
    this.isOperational = true
    Error.captureStackTrace?.(this, this.constructor)
  }
}
