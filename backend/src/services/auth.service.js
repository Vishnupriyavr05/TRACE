/**
 * @fileoverview Authentication service — register, login, JWT, password ops.
 * Uses repositories and utils only; never touches MongoDB or Express directly.
 */
import * as userRepository from '../repositories/user.repository.js'
import { hashPassword, comparePassword } from '../utils/password.util.js'
import { generateToken, verifyToken } from '../utils/jwt.util.js'
import { AppError } from '../utils/AppError.js'

/**
 * Remove sensitive fields before returning a user to controllers.
 *
 * @param {object} user
 * @returns {object}
 */
function sanitizeUser(user) {
  if (!user) return null
  const { password, __v, ...safe } = user
  return safe
}

/**
 * Hash a plaintext password.
 *
 * @param {string} plainPassword
 * @returns {Promise<string>}
 */
export async function hashUserPassword(plainPassword) {
  return hashPassword(plainPassword)
}

/**
 * Compare plaintext password with stored hash.
 *
 * @param {string} plainPassword
 * @param {string} hashedPassword
 * @returns {Promise<boolean>}
 */
export async function compareUserPassword(plainPassword, hashedPassword) {
  return comparePassword(plainPassword, hashedPassword)
}

/**
 * Generate a JWT for a user id.
 *
 * @param {string} userId
 * @returns {string}
 */
export function generateAuthToken(userId) {
  return generateToken({ id: String(userId) })
}

/**
 * Verify a JWT and return the decoded payload.
 *
 * @param {string} token
 * @returns {{ id: string, iat?: number, exp?: number }}
 */
export function verifyAuthToken(token) {
  try {
    return verifyToken(token)
  } catch {
    throw new AppError('Invalid or expired token', 401)
  }
}

/**
 * Update lastLogin timestamp for a user.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function updateLastLogin(userId) {
  return userRepository.updateUser(userId, { lastLogin: new Date() })
}

/**
 * Register a new user account.
 *
 * @param {{ name: string, email: string, password: string, avatar?: string }} input
 * @returns {Promise<{ user: object, token: string }>}
 */
export async function registerUser(input) {
  const email = input.email.toLowerCase().trim()
  const existing = await userRepository.findByEmail(email)

  if (existing) {
    throw new AppError('An account with this email already exists', 409)
  }

  const hashed = await hashUserPassword(input.password)

  const created = await userRepository.createUser({
    name: input.name.trim(),
    email,
    password: hashed,
    avatar: input.avatar ?? null,
  })

  const token = generateAuthToken(created._id)

  return {
    user: sanitizeUser(created),
    token,
  }
}

/**
 * Authenticate a user with email and password.
 *
 * @param {{ email: string, password: string }} input
 * @returns {Promise<{ user: object, token: string }>}
 */
export async function loginUser(input) {
  const email = input.email.toLowerCase().trim()
  const user = await userRepository.findByEmail(email, { includePassword: true })

  if (!user || !user.isActive) {
    throw new AppError('Invalid email or password', 401)
  }

  const matches = await compareUserPassword(input.password, user.password)
  if (!matches) {
    throw new AppError('Invalid email or password', 401)
  }

  const updated = await updateLastLogin(user._id)
  const token = generateAuthToken(user._id)

  return {
    user: sanitizeUser(updated || user),
    token,
  }
}

/**
 * Load the current authenticated user by id.
 *
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function getCurrentUser(userId) {
  const user = await userRepository.findById(userId)

  if (!user || !user.isActive) {
    throw new AppError('User not found', 404)
  }

  return sanitizeUser(user)
}
