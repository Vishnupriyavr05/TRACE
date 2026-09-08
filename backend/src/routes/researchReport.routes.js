/**
 * @fileoverview Research report routes.
 */
import { Router } from 'express'
import * as controller from '../controllers/researchReport.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import {
  validateCreateResearchReport,
  validateUpdateResearchReport,
} from '../validators/researchReport.validator.js'

const router = Router()
router.use(authenticate)

router.post('/', validateBody(validateCreateResearchReport), controller.create)
router.get('/', controller.list)
router.get('/session/:sessionId', controller.getBySession)
router.get('/:id', controller.getById)
router.patch(
  '/:id',
  validateBody(validateUpdateResearchReport),
  controller.update
)
router.delete('/:id', controller.remove)

export default router
