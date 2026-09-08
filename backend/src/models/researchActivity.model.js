/**
 * @fileoverview ResearchActivity model — session activity timeline.
 */
import mongoose from 'mongoose'

export const ACTIVITY_TYPES = Object.freeze([
  'session.created',
  'session.renamed',
  'session.restored',
  'session.archived',
  'session.deleted',
  'query.executed',
  'documents.uploaded',
  'discovery.completed',
  'canonicalization.completed',
  'run.started',
  'run.completed',
  'run.failed',
  'agent.started',
  'agent.completed',
  'paper.pinned',
  'paper.feedback',
  'graph.created',
  'graph.updated',
  'KNOWLEDGE_GRAPH_BUILD_STARTED',
  'KNOWLEDGE_GRAPH_BUILD_COMPLETED',
  'KNOWLEDGE_GRAPH_BUILD_FAILED',
  'AI_PLANNER_STARTED',
  'AI_PLANNER_COMPLETED',
  'AI_PLANNER_FAILED',
  'AI_EXPLORER_STARTED',
  'AI_EXPLORER_COMPLETED',
  'AI_EXPLORER_FAILED',
  'AI_EVIDENCE_ANALYST_STARTED',
  'AI_EVIDENCE_ANALYST_COMPLETED',
  'AI_EVIDENCE_ANALYST_FAILED',
  'AI_CRITIC_STARTED',
  'AI_CRITIC_COMPLETED',
  'AI_CRITIC_FAILED',
  'AI_SYNTHESIZER_STARTED',
  'AI_SYNTHESIZER_COMPLETED',
  'AI_SYNTHESIZER_FAILED',
  'AI_RESEARCH_STARTED',
  'AI_RESEARCH_CHECKPOINT',
  'AI_RESEARCH_REFINEMENT_COMPLETED',
  'AI_RESEARCH_COMPLETED',
  'AI_RESEARCH_FAILED',
  'AI_PROVIDER_RATE_LIMITED',
  'report.generated',
  'report.updated',
  'explainability.updated',
  'ai.execution',
  'other',
])

const researchActivitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchSession',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: true,
    },
    description: { type: String, default: '', trim: true },
    message: { type: String, default: '', trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    agentId: { type: String, default: null, trim: true },
    paperId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Paper',
      default: null,
    },
    severity: {
      type: String,
      enum: ['info', 'warning', 'error'],
      default: 'info',
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'research_activities',
  }
)

researchActivitySchema.index({ sessionId: 1, createdAt: -1 })
researchActivitySchema.index({ userId: 1, createdAt: -1 })
researchActivitySchema.index({ type: 1, createdAt: -1 })

const ResearchActivity = mongoose.model(
  'ResearchActivity',
  researchActivitySchema
)
export default ResearchActivity
