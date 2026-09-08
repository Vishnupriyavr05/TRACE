/**
 * @fileoverview Research Discovery routes.
 */
import { Router } from 'express'
import * as discoveryController from '../controllers/researchDiscovery.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { validateDiscoverySearch } from '../validators/researchDiscovery.validator.js'

const router = Router()

router.use(authenticate)

router.get('/providers', discoveryController.listProviders)

router.post(
  '/search',
  validateBody(validateDiscoverySearch),
  discoveryController.search
)

export default router
