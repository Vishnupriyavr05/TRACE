/**
 * @fileoverview Upload request validators — source file uploads.
 *
 * Future responsibility:
 * - Validate MIME types, size limits, and file counts for Workspace uploads
 * - Align with future GROBID full-text pipelines
 *
 * No Joi/Zod / multer wiring yet — interface only.
 */

/**
 * @param {object} file Multer-like file descriptor
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateUploadedFile(file) {
  throw new Error('Not implemented')
}

/**
 * @param {object[]} files
 * @returns {{ ok: boolean, errors?: string[], value?: object }}
 */
export function validateUploadedFiles(files) {
  throw new Error('Not implemented')
}
