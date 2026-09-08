/**
 * @fileoverview Deterministic PDF validation (magic bytes only).
 */

/**
 * @param {Buffer|Uint8Array|null|undefined} buffer
 * @returns {boolean}
 */
export function isValidPdfBuffer(buffer) {
  if (!buffer || buffer.length < 5) return false
  return (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  )
}

export default { isValidPdfBuffer }
