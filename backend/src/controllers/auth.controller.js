/**
 * @fileoverview Auth HTTP controllers — register, login, current user.
 */
import * as authService from '../services/auth.service.js'
import { AppError } from '../utils/AppError.js'

/**
 * POST /auth/register
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function register(req, res, next) {
  try {
    const { user, token } = await authService.registerUser(req.validated)

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user,
        token,
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /auth/login
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function login(req, res, next) {
  try {
    const { user, token } = await authService.loginUser(req.validated)

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user,
    })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /auth/me — requires authentication middleware.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function me(req, res, next) {
  try {
    if (!req.user?.id && !req.user?._id) {
      throw new AppError('Authentication required', 401)
    }

    const userId = String(req.user.id || req.user._id)
    const user = await authService.getCurrentUser(userId)

    res.status(200).json({
      success: true,
      message: 'Current user retrieved successfully',
      data: { user },
    })
  } catch (error) {
    next(error)
  }
}
