/**
 * @fileoverview Knowledge graph routes.
 */
import { Router } from 'express'
import * as controller from '../controllers/knowledgeGraph.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import {
  validateCreateKnowledgeGraph,
  validateUpdateKnowledgeGraph,
} from '../validators/knowledgeGraph.validator.js'

const router = Router()
router.use(authenticate)

router.post('/', validateBody(validateCreateKnowledgeGraph), controller.create)
router.get('/', controller.list)
router.post('/session/:sessionId/build', controller.buildForSession)
router.get('/session/:sessionId', controller.getBySession)
router.get('/:id', controller.getById)
router.patch(
  '/:id',
  validateBody(validateUpdateKnowledgeGraph),
  controller.update
)
router.delete('/:id', controller.remove)

export default router
