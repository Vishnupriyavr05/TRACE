/**
 * @fileoverview Auth request validators — shape checks before controllers.
 */

const EMAIL_RE = /^\S+@\S+\.\S+$/

/**
 * Strong password: min 8 chars, at least one letter and one number.
 *
 * @param {string} password
 * @returns {boolean}
 */
function isStrongPassword(password) {
  if (typeof password !== 'string' || password.length < 8) return false
  if (!/[A-Za-z]/.test(password)) return false
  if (!/[0-9]/.test(password)) return false
  return true
}

/**
 * Validate registration request body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateRegister(body = {}) {
  const errors = []
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const avatar =
    typeof body.avatar === 'string' && body.avatar.trim()
      ? body.avatar.trim()
      : undefined

  if (!name) {
    errors.push('Name is required')
  } else if (name.length < 2) {
    errors.push('Name must be at least 2 characters')
  }

  if (!email) {
    errors.push('Email is required')
  } else if (!EMAIL_RE.test(email)) {
    errors.push('Please provide a valid email address')
  }

  if (!password) {
    errors.push('Password is required')
  } else if (!isStrongPassword(password)) {
    errors.push(
      'Password must be at least 8 characters and include at least one letter and one number'
    )
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: { name, email: email.toLowerCase(), password, avatar },
  }
}

/**
 * Validate login request body.
 *
 * @param {object} body
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateLogin(body = {}) {
  const errors = []
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email) {
    errors.push('Email is required')
  } else if (!EMAIL_RE.test(email)) {
    errors.push('Please provide a valid email address')
  }

  if (!password) {
    errors.push('Password is required')
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: { email: email.toLowerCase(), password },
  }
}
