/**
 * @fileoverview ResearchDocument model — uploaded file metadata only (no parsing/AI).
 */
import mongoose from 'mongoose'

/** @type {readonly string[]} */
export const DOCUMENT_TYPES = Object.freeze([
  'PDF',
  'DOCX',
  'TXT',
  'RIS',
  'BIBTEX',
  'ZIP',
  'OTHER',
])

/** @type {readonly string[]} */
export const UPLOAD_SOURCES = Object.freeze(['USER_UPLOAD', 'SYSTEM_IMPORT'])

/** @type {readonly string[]} */
export const DOCUMENT_STATUSES = Object.freeze([
  'UPLOADED',
  'READY',
  'PROCESSING',
  'FAILED',
])

const researchDocumentSchema = new mongoose.Schema(
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
    originalName: {
      type: String,
      required: [true, 'originalName is required'],
      trim: true,
      maxlength: [500, 'originalName must be at most 500 characters'],
    },
    storedName: {
      type: String,
      required: [true, 'storedName is required'],
      trim: true,
    },
    mimeType: {
      type: String,
      required: [true, 'mimeType is required'],
      trim: true,
    },
    extension: {
      type: String,
      required: [true, 'extension is required'],
      trim: true,
      lowercase: true,
    },
    size: {
      type: Number,
      required: [true, 'size is required'],
      min: [0, 'size cannot be negative'],
    },
    storagePath: {
      type: String,
      required: [true, 'storagePath is required'],
      trim: true,
      select: false,
    },
    documentType: {
      type: String,
      enum: {
        values: DOCUMENT_TYPES,
        message: 'Invalid documentType',
      },
      required: true,
      default: 'OTHER',
    },
    uploadSource: {
      type: String,
      enum: {
        values: UPLOAD_SOURCES,
        message: 'Invalid uploadSource',
      },
      default: 'USER_UPLOAD',
    },
    status: {
      type: String,
      enum: {
        values: DOCUMENT_STATUSES,
        message: 'Invalid status',
      },
      default: 'UPLOADED',
      index: true,
    },
    checksum: {
      type: String,
      required: [true, 'checksum is required'],
      trim: true,
    },
    linkedPaperId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Paper',
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'research_documents',
  }
)

researchDocumentSchema.index({ sessionId: 1, createdAt: -1 })
researchDocumentSchema.index({ userId: 1, sessionId: 1 })
researchDocumentSchema.index({ checksum: 1 })

researchDocumentSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v
    delete ret.storagePath
    return ret
  },
})

const ResearchDocument = mongoose.model(
  'ResearchDocument',
  researchDocumentSchema
)

export default ResearchDocument
