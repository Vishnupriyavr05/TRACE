/**
 * @fileoverview GraphRAG routes.
 */
import { Router } from 'express'
import * as controller from '../controllers/graphRag.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { validateGraphRagRetrieve } from '../validators/graphRag.validator.js'

const router = Router()

router.use(authenticate)

router.post(
  '/retrieve',
  validateBody(validateGraphRagRetrieve),
  controller.retrieve
)

export default router
