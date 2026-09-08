/**
 * @fileoverview Multer configuration for research document uploads.
 * Controllers must not contain Multer storage logic.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import multer from 'multer'
import { fileURLToPath } from 'url'
import { AppError } from '../../utils/AppError.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Absolute path to backend/uploads */
export const UPLOADS_ROOT = path.resolve(__dirname, '../../../uploads')

/** Current upload limit: 25 MB */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/** Currently accepted MIME types (PDF only). Expand later without changing callers. */
export const ALLOWED_MIME_TYPES = Object.freeze(['application/pdf'])

/** Temporary staging directory before moving into user/session folders */
export const TEMP_UPLOAD_DIR = path.join(UPLOADS_ROOT, '.tmp')

/**
 * Ensure a directory exists.
 *
 * @param {string} dirPath
 */
export function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

/**
 * Build a unique stored filename preserving the extension.
 *
 * @param {string} originalName
 * @returns {string}
 */
export function generateStoredFilename(originalName) {
  const ext = path.extname(originalName || '').toLowerCase() || '.bin'
  const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`
  return `${unique}${ext}`
}

/**
 * Map a MIME type / extension to a documentType enum value.
 * Future formats can be enabled here without changing the upload pipeline.
 *
 * @param {string} mimeType
 * @param {string} extension
 * @returns {string}
 */
export function resolveDocumentType(mimeType, extension) {
  const ext = (extension || '').replace(/^\./, '').toLowerCase()
  const mime = (mimeType || '').toLowerCase()

  if (mime === 'application/pdf' || ext === 'pdf') return 'PDF'
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return 'DOCX'
  }
  if (mime === 'text/plain' || ext === 'txt') return 'TXT'
  if (ext === 'ris') return 'RIS'
  if (ext === 'bib' || ext === 'bibtex') return 'BIBTEX'
  if (mime === 'application/zip' || ext === 'zip') return 'ZIP'
  return 'OTHER'
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      ensureDirectory(TEMP_UPLOAD_DIR)
      cb(null, TEMP_UPLOAD_DIR)
    } catch (error) {
      cb(error)
    }
  },
  filename(_req, file, cb) {
    cb(null, generateStoredFilename(file.originalname))
  },
})

/**
 * Reject non-PDF uploads at the Multer layer (current product policy).
 *
 * @param {import('express').Request} _req
 * @param {Express.Multer.File} file
 * @param {multer.FileFilterCallback} cb
 */
function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new AppError(
        'Only PDF files are currently supported. Allowed type: application/pdf',
        400,
        ['Invalid file type']
      )
    )
  }

  const ext = path.extname(file.originalname || '').toLowerCase()
  if (ext && ext !== '.pdf') {
    return cb(
      new AppError(
        'Only PDF files are currently supported (.pdf extension required)',
        400,
        ['Invalid file extension']
      )
    )
  }

  cb(null, true)
}

/**
 * Multer middleware for a single research document field named `file`.
 */
export const uploadResearchDocument = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
}).single('file')
