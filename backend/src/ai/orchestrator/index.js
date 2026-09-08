/**
 * @fileoverview Research Orchestrator public surface.
 */
export {
  runResearch,
  RESEARCH_ACTIVITY,
  WORKFLOW_STAGE,
} from './researchOrchestrator.service.js'

export { shouldRefine, MAX_REFINEMENTS } from './refinementDecider.js'
export { mergeEvidencePackages } from './evidenceMerge.js'
export {
  CHECKPOINT_ACTIVITY,
  selectResumeState,
  buildCheckpointActivity,
} from './researchCheckpoint.js'
