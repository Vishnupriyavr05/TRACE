/**
 * @fileoverview 404 handler for unmatched routes.
 */
export function notFoundMiddleware(req, res, next) {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  })
}
