/**
 * @fileoverview ResearchSession routes — authenticated workspace shell APIs.
 */
import { Router } from 'express'
import * as sessionController from '../controllers/researchSession.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'
import {
  validateBody,
  validateQuery,
} from '../middleware/validate.middleware.js'
import {
  validateCreateSession,
  validateUpdateSession,
  validateListSessionsQuery,
  validatePinSession,
} from '../validators/researchSession.validator.js'

const router = Router()

router.use(authenticate)

router.post(
  '/',
  validateBody(validateCreateSession),
  sessionController.createSession
)

router.get(
  '/',
  validateQuery(validateListSessionsQuery),
  sessionController.listSessions
)

router.get('/:id', sessionController.getSession)

router.patch(
  '/:id',
  validateBody(validateUpdateSession),
  sessionController.updateSession
)

router.delete('/:id', sessionController.deleteSession)

router.patch(
  '/:id/pin',
  validateBody(validatePinSession),
  sessionController.pinSession
)

router.patch('/:id/archive', sessionController.archiveSession)

export default router
