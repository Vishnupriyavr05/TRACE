/**
 * @fileoverview KnowledgeGraph model — persisted graph shell for a session.
 * Persistence only; no graph generation.
 */
import mongoose from 'mongoose'

const nodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    importance: {
      type: String,
      enum: ['primary', 'major', 'minor'],
      default: 'minor',
    },
    description: { type: String, default: '' },
    relatedPaperIds: { type: [mongoose.Schema.Types.Mixed], default: [] },
    x: { type: Number, default: null },
    y: { type: Number, default: null },
    properties: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
)

const linkSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    source: { type: String, required: true, trim: true },
    target: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    explanation: { type: String, default: '' },
    confidence: { type: Number, default: null, min: 0, max: 100 },
    supportingPaperIds: { type: [mongoose.Schema.Types.Mixed], default: [] },
    properties: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
)

const knowledgeGraphSchema = new mongoose.Schema(
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
    runId: { type: String, default: null, trim: true },
    kind: { type: String, default: 'concept', trim: true },
    version: { type: Number, default: 1, min: 1 },
    schemaVersion: { type: Number, default: 1, min: 1 },
    nodes: { type: [nodeSchema], default: [] },
    links: { type: [linkSchema], default: [] },
    paperIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Paper' }],
      default: [],
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    stats: {
      nodeCount: { type: Number, default: 0 },
      linkCount: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['empty', 'draft', 'ready', 'stale'],
      default: 'empty',
    },
  },
  {
    timestamps: true,
    collection: 'knowledge_graphs',
  }
)

knowledgeGraphSchema.index({ userId: 1, updatedAt: -1 })

knowledgeGraphSchema.pre('validate', function syncStats() {
  this.stats = {
    nodeCount: Array.isArray(this.nodes) ? this.nodes.length : 0,
    linkCount: Array.isArray(this.links) ? this.links.length : 0,
  }
})

const KnowledgeGraph = mongoose.model('KnowledgeGraph', knowledgeGraphSchema)
export default KnowledgeGraph
