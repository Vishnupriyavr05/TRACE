/**
 * @fileoverview Research document routes — authenticated upload / manage / download.
 */
import { Router } from 'express'
import * as documentController from '../controllers/researchDocument.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'
import { uploadResearchDocument } from '../config/multer/multer.config.js'
import { validateUploadDocument } from '../validators/researchDocument.validator.js'
import { AppError } from '../utils/AppError.js'

const router = Router()

router.use(authenticate)

/**
 * Run Multer and forward Multer/AppError failures to the error middleware.
 *
 * @type {import('express').RequestHandler}
 */
function handleUpload(req, res, next) {
  uploadResearchDocument(req, res, (err) => {
    if (!err) return next()

    if (err instanceof AppError) {
      return next(err)
    }

    if (err?.code === 'LIMIT_FILE_SIZE') {
      return next(
        new AppError('File too large. Maximum allowed size is 25 MB', 400, [
          'File exceeds 25 MB limit',
        ])
      )
    }

    if (err?.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(
        new AppError('Unexpected file field. Use form field name "file".', 400)
      )
    }

    return next(
      new AppError(err.message || 'File upload failed', 400)
    )
  })
}

/**
 * Validate sessionId after Multer parses multipart fields into req.body.
 *
 * @type {import('express').RequestHandler}
 */
function validateUploadFields(req, _res, next) {
  const result = validateUploadDocument(req.body)
  if (!result.ok) {
    return next(new AppError('Validation failed', 400, result.errors || []))
  }
  req.validated = result.value
  next()
}

router.post(
  '/upload',
  handleUpload,
  validateUploadFields,
  documentController.uploadDocument
)

router.get('/session/:sessionId', documentController.listBySession)

router.get('/:id/download', documentController.downloadDocument)

router.get('/:id', documentController.getDocument)

router.delete('/:id', documentController.deleteDocument)

export default router
