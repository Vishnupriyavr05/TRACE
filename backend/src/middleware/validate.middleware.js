/**
 * @fileoverview Request validation middleware factories.
 */
import { AppError } from '../utils/AppError.js'

/**
 * Run a validator against `req.body` and attach sanitized `req.validated`.
 *
 * @param {(body: object) => { ok: boolean, errors?: string[], value?: object }} validatorFn
 * @returns {import('express').RequestHandler}
 */
export function validateBody(validatorFn) {
  return (req, _res, next) => {
    const result = validatorFn(req.body)

    if (!result.ok) {
      return next(
        new AppError('Validation failed', 400, result.errors || [])
      )
    }

    req.validated = result.value
    next()
  }
}

/**
 * Run a validator against `req.query` and attach sanitized `req.validatedQuery`.
 *
 * @param {(query: object) => { ok: boolean, errors?: string[], value?: object }} validatorFn
 * @returns {import('express').RequestHandler}
 */
export function validateQuery(validatorFn) {
  return (req, _res, next) => {
    const result = validatorFn(req.query)

    if (!result.ok) {
      return next(
        new AppError('Validation failed', 400, result.errors || [])
      )
    }

    req.validatedQuery = result.value
    next()
  }
}
