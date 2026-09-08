/**
 * @fileoverview JWT sign and verify helpers.
 */
import jwt from 'jsonwebtoken'
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/environment/env.js'

/**
 * Generate a signed JWT for an authenticated user.
 *
 * @param {{ id: string }} payload
 * @returns {string}
 */
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  })
}

/**
 * Verify a JWT and return its decoded payload.
 *
 * @param {string} token
 * @returns {{ id: string, iat?: number, exp?: number }}
 */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}
