/**
 * @fileoverview Mongoose Paper model — session-scoped scholarly records.
 */
import mongoose from 'mongoose'

const paperSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchSession',
      required: [true, 'sessionId is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    rank: {
      type: Number,
      default: null,
    },
    externalIds: {
      doi: { type: String, default: null, trim: true, lowercase: true },
      openAlexId: { type: String, default: null, trim: true },
      semanticScholarId: { type: String, default: null, trim: true },
      arxivId: { type: String, default: null, trim: true },
      uploadDocumentId: { type: String, default: null, trim: true },
    },
    title: {
      type: String,
      required: [true, 'title is required'],
      trim: true,
      maxlength: [500, 'title must be at most 500 characters'],
    },
    authors: {
      type: [String],
      default: [],
    },
    year: {
      type: Number,
      default: null,
    },
    venue: {
      type: String,
      default: '',
      trim: true,
    },
    abstract: {
      type: String,
      default: '',
    },
    url: {
      type: String,
      default: null,
      trim: true,
    },
    pdfCandidates: {
      type: [String],
      default: [],
    },
    fullTextSources: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    openAlexLocations: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    citationCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    confidence: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    badges: {
      type: [String],
      default: [],
    },
    keywords: {
      type: [String],
      default: [],
    },
    paperType: {
      type: String,
      default: 'other',
      trim: true,
    },
    integrity: {
      peerReviewed: { type: mongoose.Schema.Types.Mixed, default: null },
      openAccess: { type: Boolean, default: null },
      retractionStatus: { type: String, default: 'none' },
      correctionStatus: { type: String, default: 'none' },
      venueQuality: { type: String, default: null },
    },
    reproducibility: {
      codeAvailable: { type: Boolean, default: false },
      datasetAvailable: { type: Boolean, default: false },
      githubRepository: { type: String, default: null },
      papersWithCode: { type: Boolean, default: false },
    },
    evidenceLocation: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    citationTree: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    source: {
      type: String,
      enum: [
        'openalex',
        'semantic_scholar',
        'crossref',
        'core',
        'upload',
        'manual',
        'other',
      ],
      default: 'manual',
    },
    sources: {
      type: [
        {
          provider: { type: String, required: true },
          contributed: { type: [String], default: [] },
          _id: false,
        },
      ],
      default: [],
    },
    discoveryMethod: {
      type: String,
      default: null,
      trim: true,
    },
    raw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    collection: 'papers',
  }
)

paperSchema.index({ sessionId: 1, rank: 1 }, { name: 'session_rank' })
paperSchema.index(
  { sessionId: 1, 'externalIds.doi': 1 },
  {
    name: 'session_doi',
    unique: true,
    partialFilterExpression: {
      'externalIds.doi': { $type: 'string', $gt: '' },
    },
  }
)
paperSchema.index({ sessionId: 1, createdAt: -1 })
paperSchema.index(
  { sessionId: 1, 'externalIds.uploadDocumentId': 1 },
  {
    name: 'session_upload_document',
    unique: true,
    partialFilterExpression: {
      'externalIds.uploadDocumentId': { $type: 'string', $gt: '' },
    },
  }
)

paperSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v
    delete ret.raw
    return ret
  },
})

const Paper = mongoose.model('Paper', paperSchema)

export default Paper
