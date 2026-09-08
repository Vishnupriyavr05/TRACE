/**
 * @fileoverview Password hashing and comparison utilities (bcrypt).
 */
import bcrypt from 'bcrypt'

const SALT_ROUNDS = 12

/**
 * Hash a plaintext password.
 *
 * @param {string} plainPassword
 * @returns {Promise<string>}
 */
export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS)
}

/**
 * Compare a plaintext password with a stored hash.
 *
 * @param {string} plainPassword
 * @param {string} hashedPassword
 * @returns {Promise<boolean>}
 */
export async function comparePassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword)
}
