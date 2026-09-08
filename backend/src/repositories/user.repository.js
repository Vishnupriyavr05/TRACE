/**
 * @fileoverview User repository — sole DB access for user documents.
 * No business logic (hashing, JWT, HTTP) belongs here.
 */
import User from '../models/user.model.js'

/**
 * Insert a new user document.
 *
 * @param {object} userData
 * @returns {Promise<object>}
 */
export async function createUser(userData) {
  const user = await User.create(userData)
  const plain = user.toObject()
  delete plain.password
  delete plain.__v
  return plain
}

/**
 * Find a user by email address.
 *
 * @param {string} email
 * @param {{ includePassword?: boolean }} [options]
 * @returns {Promise<object|null>}
 */
export async function findByEmail(email, options = {}) {
  const query = User.findOne({ email: email.toLowerCase().trim() }).lean()
  if (options.includePassword) {
    query.select('+password')
  }
  return query.exec()
}

/**
 * Find a user by MongoDB ObjectId string.
 *
 * @param {string} userId
 * @param {{ includePassword?: boolean }} [options]
 * @returns {Promise<object|null>}
 */
export async function findById(userId, options = {}) {
  const query = User.findById(userId).lean()
  if (options.includePassword) {
    query.select('+password')
  }
  return query.exec()
}

/**
 * Update an existing user by id.
 *
 * @param {string} userId
 * @param {object} updates
 * @returns {Promise<object|null>}
 */
export async function updateUser(userId, updates) {
  return User.findByIdAndUpdate(userId, updates, {
    new: true,
    runValidators: true,
  })
    .lean()
    .exec()
}

/**
 * Delete a user by id (hard delete for now).
 *
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function deleteUser(userId) {
  const result = await User.findByIdAndDelete(userId).exec()
  return Boolean(result)
}
