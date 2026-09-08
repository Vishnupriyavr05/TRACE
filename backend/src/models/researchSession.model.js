/**
 * @fileoverview Mongoose ResearchSession model — lightweight saved workspace shell.
 * Does not store papers, reports, graphs, or research content.
 */
import mongoose from 'mongoose'

/** @type {readonly string[]} */
export const SESSION_STATUSES = Object.freeze([
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED',
])

const filtersSchema = new mongoose.Schema(
  {
    yearFrom: { type: mongoose.Schema.Types.Mixed, default: '' },
    yearTo: { type: mongoose.Schema.Types.Mixed, default: '' },
    publicationType: { type: String, default: '', trim: true },
    minCitations: { type: mongoose.Schema.Types.Mixed, default: '' },
    openAccess: { type: Boolean, default: false },
    sortBy: {
      type: String,
      enum: ['relevant', 'cited', 'newest'],
      default: 'relevant',
    },
  },
  { _id: false }
)

const uploadedFileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    size: { type: Number, default: null },
    mimeType: { type: String, default: null, trim: true },
    storageKey: { type: String, default: null, trim: true },
  },
  { _id: false }
)

const workspaceStateSchema = new mongoose.Schema(
  {
    graphMode: {
      type: String,
      enum: ['concept', 'citation'],
      default: 'concept',
    },
    selectedPaperId: { type: mongoose.Schema.Types.Mixed, default: null },
    selectedConceptId: { type: String, default: null, trim: true },
    expandedAccordion: { type: String, default: null, trim: true },
    activePanel: { type: String, default: null, trim: true },
  },
  { _id: false }
)

const researchSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    sessionTitle: {
      type: String,
      required: [true, 'Session title is required'],
      trim: true,
      minlength: [1, 'Session title must be at least 1 character'],
      maxlength: [200, 'Session title must be at most 200 characters'],
    },
    researchQuery: {
      type: String,
      required: [true, 'Research query is required'],
      trim: true,
      minlength: [3, 'Research query must be at least 3 characters'],
      maxlength: [2000, 'Research query must be at most 2000 characters'],
    },
    domain: {
      type: String,
      default: '',
      trim: true,
    },
    paperTypes: {
      type: [String],
      default: [],
    },
    filters: {
      type: filtersSchema,
      default: () => ({}),
    },
    selectedSources: {
      type: [String],
      default: [],
    },
    uploadedFiles: {
      type: [uploadedFileSchema],
      default: [],
    },
    workspaceState: {
      type: workspaceStateSchema,
      default: () => ({}),
    },
    status: {
      type: String,
      enum: {
        values: SESSION_STATUSES,
        message: 'Status must be ACTIVE, COMPLETED, or ARCHIVED',
      },
      default: 'ACTIVE',
      index: true,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    lastOpenedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'research_sessions',
  }
)

researchSessionSchema.index({ sessionTitle: 1 })
researchSessionSchema.index({ userId: 1, isArchived: 1, updatedAt: -1 })
researchSessionSchema.index({ userId: 1, isPinned: 1, updatedAt: -1 })
researchSessionSchema.index({ userId: 1, status: 1 })
researchSessionSchema.index({ userId: 1, lastOpenedAt: -1 })
researchSessionSchema.index(
  { sessionTitle: 'text', researchQuery: 'text' },
  { name: 'session_text_search' }
)

researchSessionSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v
    return ret
  },
})

const ResearchSession = mongoose.model('ResearchSession', researchSessionSchema)

export default ResearchSession
