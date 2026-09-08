/**
 * @fileoverview Lightweight PDF metadata extraction (Info dict + DOI scan).
 */
const DOI_PATTERN = /\b10\.\d{4,9}\/[^\s"'<>]+/i

/**
 * @param {string} originalName
 * @returns {string}
 */
export function fallbackTitleFromFilename(originalName) {
  const base = String(originalName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  return base || 'Uploaded document'
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
function bufferToLatin1(buffer) {
  return buffer.toString('latin1')
}

/**
 * @param {string} haystack
 * @param {string} key
 * @returns {string|null}
 */
function readPdfInfoString(haystack, key) {
  const re = new RegExp(`/${key}\\s*\\(([^)]*)\\)`, 'i')
  const match = haystack.match(re)
  if (!match) return null
  return match[1]
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .trim() || null
}

/**
 * @param {string|null|undefined} text
 * @returns {string[]}
 */
function parseAuthors(text) {
  if (!text) return []
  return String(text)
    .split(/;|,|\band\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 1)
}

/**
 * @param {string|null|undefined} text
 * @returns {number|null}
 */
function parseYear(text) {
  if (!text) return null
  const match = String(text).match(/\b(19|20)\d{2}\b/)
  return match ? Number(match[0]) : null
}

/**
 * @param {Buffer} buffer
 * @param {{ originalName?: string }} [options]
 * @returns {{ title: string, authors: string[], year: number|null, doi: string|null }}
 */
export function extractPdfMetadata(buffer, options = {}) {
  const latin1 = bufferToLatin1(buffer)
  const title =
    readPdfInfoString(latin1, 'Title') ||
    fallbackTitleFromFilename(options.originalName)
  const authorField = readPdfInfoString(latin1, 'Author')
  const subject = readPdfInfoString(latin1, 'Subject')
  const authors = parseAuthors(authorField)
  const year = parseYear(subject) || parseYear(title)
  const doiMatch = latin1.match(DOI_PATTERN)
  const doi = doiMatch ? doiMatch[0].replace(/[.,;]+$/, '').toLowerCase() : null

  return {
    title: title.slice(0, 500),
    authors,
    year,
    doi,
  }
}

export default {
  extractPdfMetadata,
  fallbackTitleFromFilename,
}
