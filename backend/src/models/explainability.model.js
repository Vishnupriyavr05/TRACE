/**
 * @fileoverview Explainability metadata model — persistence placeholders only.
 * Values are not calculated here; future AI agents will populate them.
 */
import mongoose from 'mongoose'

const explainabilitySchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchSession',
      required: true,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchReport',
      default: null,
    },
    graphId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'KnowledgeGraph',
      default: null,
    },
    evidenceLinks: { type: [mongoose.Schema.Types.Mixed], default: [] },
    confidenceScores: { type: mongoose.Schema.Types.Mixed, default: {} },
    reasoningChains: { type: [mongoose.Schema.Types.Mixed], default: [] },
    sourceAttribution: { type: [mongoose.Schema.Types.Mixed], default: [] },
    citationSupport: { type: [mongoose.Schema.Types.Mixed], default: [] },
    contradictions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    researchGaps: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: {
      type: String,
      enum: ['empty', 'draft', 'ready', 'stale'],
      default: 'empty',
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'explainability_metadata',
  }
)

explainabilitySchema.index({ userId: 1, updatedAt: -1 })

const Explainability = mongoose.model('Explainability', explainabilitySchema)
export default Explainability
