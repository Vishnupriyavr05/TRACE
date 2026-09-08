/**
 * @fileoverview AI routes — individual agents + Research Orchestrator.
 */
import { Router } from 'express'
import * as controller from '../controllers/ai.controller.js'
import { authenticate } from '../middleware/auth.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import {
  validatePlannerRequest,
  validateExplorerRequest,
  validateEvidenceAnalysisRequest,
  validateCriticRequest,
  validateSynthesizeRequest,
  validateResearchRequest,
} from '../validators/ai.validator.js'

const router = Router()

router.use(authenticate)

router.post(
  '/planner',
  validateBody(validatePlannerRequest),
  controller.runPlanner
)

router.post(
  '/explorer',
  validateBody(validateExplorerRequest),
  controller.runExplorer
)

router.post(
  '/evidence-analysis',
  validateBody(validateEvidenceAnalysisRequest),
  controller.runEvidenceAnalyst
)

router.post(
  '/critic',
  validateBody(validateCriticRequest),
  controller.runCritic
)

router.post(
  '/synthesize',
  validateBody(validateSynthesizeRequest),
  controller.runSynthesizer
)

router.post(
  '/research',
  validateBody(validateResearchRequest),
  controller.runResearch
)

export default router
