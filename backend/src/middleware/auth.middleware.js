/**
 * @fileoverview JWT authentication middleware — attaches req.user.
 * Role-based authorization is intentionally deferred.
 */
import * as authService from '../services/auth.service.js'
import { AppError } from '../utils/AppError.js'

/**
 * Require a valid Bearer JWT and load the authenticated user onto `req.user`.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization

    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401)
    }

    const token = header.slice(7).trim()
    if (!token) {
      throw new AppError('Authentication required', 401)
    }

    const decoded = authService.verifyAuthToken(token)
    if (!decoded?.id) {
      throw new AppError('Invalid or expired token', 401)
    }

    const user = await authService.getCurrentUser(decoded.id)
    req.user = user
    next()
  } catch (error) {
    if (error instanceof AppError) {
      return next(error)
    }
    return next(new AppError('Invalid or expired token', 401))
  }
}
