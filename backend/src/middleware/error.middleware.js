/**
 * @fileoverview Centralized Express error handler.
 */
export function errorMiddleware(err, req, res, next) {
  let statusCode = err.statusCode || err.status || 500
  let message = err.message || 'Internal server error'
  let errors = err.errors

  // Multer limits / filter errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400
    message = 'File too large. Maximum allowed size is 25 MB'
    errors = ['File exceeds 25 MB limit']
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400
    message = 'Unexpected file field. Use form field name "file".'
  }

  // Mongoose duplicate key (e.g. unique email)
  if (err.code === 11000) {
    statusCode = 409
    const field = Object.keys(err.keyPattern || {})[0] || 'field'
    message = `An account with this ${field} already exists`
  }

  // Mongoose validation errors
  if (err.name === 'ValidationError' && err.errors) {
    statusCode = 400
    message = 'Validation failed'
    errors = Object.values(err.errors).map((e) => e.message)
  }

  // Malformed ObjectId
  if (err.name === 'CastError') {
    statusCode = 400
    message = 'Invalid identifier'
  }

  // JWT library errors (if they bubble past auth middleware)
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    statusCode = 401
    message = 'Invalid or expired token'
  }

  const payload = {
    success: false,
    message,
  }

  if (Array.isArray(errors) && errors.length > 0) {
    payload.errors = errors
  }

  if (process.env.NODE_ENV !== 'production' && statusCode === 500 && err.stack) {
    payload.stack = err.stack
  }

  res.status(statusCode).json(payload)
}
