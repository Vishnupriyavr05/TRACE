/**
 * @fileoverview API v1 route aggregator.
 */
import { Router } from 'express'
import healthRoutes from './health.routes.js'
import authRoutes from './auth.routes.js'
import researchSessionRoutes from './researchSession.routes.js'
import researchDocumentRoutes from './researchDocument.routes.js'
import researchDiscoveryRoutes from './researchDiscovery.routes.js'
import knowledgeGraphRoutes from './knowledgeGraph.routes.js'
import researchReportRoutes from './researchReport.routes.js'
import researchActivityRoutes from './researchActivity.routes.js'
import graphRagRoutes from './graphRag.routes.js'
import aiRoutes from './ai.routes.js'

const router = Router()

router.use(healthRoutes)
router.use('/auth', authRoutes)
router.use('/sessions', researchSessionRoutes)
router.use('/documents', researchDocumentRoutes)
router.use('/discovery', researchDiscoveryRoutes)
router.use('/graphs', knowledgeGraphRoutes)
router.use('/reports', researchReportRoutes)
router.use('/activities', researchActivityRoutes)
router.use('/graph-rag', graphRagRoutes)
router.use('/ai', aiRoutes)

export default router
