/**
 * @fileoverview ResearchReport model — persisted insights shell for a session.
 * Sections may be empty until future AI agents populate them.
 */
import mongoose from 'mongoose'

const researchReportSchema = new mongoose.Schema(
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
    version: { type: Number, default: 1, min: 1 },
    status: {
      type: String,
      enum: ['draft', 'ready', 'stale', 'quality_warning'],
      default: 'draft',
    },
    executiveSummary: { type: String, default: '' },
    researchObjective: { type: String, default: '' },
    keyFindings: { type: [String], default: [] },
    supportingEvidence: { type: [mongoose.Schema.Types.Mixed], default: [] },
    contradictions: { type: [String], default: [] },
    researchGaps: {
      title: { type: String, default: '' },
      summary: { type: String, default: '' },
      evidence: { type: String, default: '' },
      items: { type: [String], default: [] },
    },
    confidence: { type: Number, default: 0, min: 0, max: 100 },
    confidenceBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
    references: { type: [String], default: [] },
    recommendations: { type: [String], default: [] },
    // Backward-compatible aliases used by earlier DDD naming
    summary: { type: String, default: '' },
    findings: { type: [String], default: [] },
    methodology: {
      strengths: { type: [String], default: [] },
      weaknesses: { type: [String], default: [] },
      limitations: { type: String, default: '' },
    },
    generationMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    findingConceptMap: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'research_reports',
  }
)

researchReportSchema.index({ userId: 1, updatedAt: -1 })

const ResearchReport = mongoose.model('ResearchReport', researchReportSchema)
export default ResearchReport
