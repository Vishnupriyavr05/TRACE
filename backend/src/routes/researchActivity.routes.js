/**
 * @fileoverview Research activity routes.
 */
import { Router } from 'express'
import * as controller from '../controllers/researchActivity.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import {
  validateCreateResearchActivity,
  validateUpdateResearchActivity,
} from '../validators/researchActivity.validator.js'

const router = Router()
router.use(authenticate)

router.post('/', validateBody(validateCreateResearchActivity), controller.create)
router.get('/session/:sessionId', controller.listBySession)
router.get('/:id', controller.getById)
router.patch(
  '/:id',
  validateBody(validateUpdateResearchActivity),
  controller.update
)
router.delete('/:id', controller.remove)

export default router
