/**
 * @fileoverview Binary HTTP fetch helper for PDF acquisition (no LLM).
 */

/**
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function isLikelyHtmlResponse(buffer) {
  if (!buffer || buffer.length < 5) return false
  const head = buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8').trimStart()
  return (
    head.startsWith('<!DOCTYPE') ||
    head.startsWith('<html') ||
    head.startsWith('<HTML') ||
    head.startsWith('<?xml') && head.toLowerCase().includes('<html')
  )
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, headers?: Record<string, string>, source?: string }} [options]
 * @returns {Promise<{ buffer: Buffer, contentType: string|null, finalUrl: string|null }>}
 */
export async function fetchBinary(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (compatible; Explainable-GraphRAG/1.0; +https://github.com/)',
        ...(options.headers || {}),
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} fetching ${options.source || 'resource'}`,
      )
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const contentType = response.headers.get('content-type')

    if (
      contentType &&
      /text\/html|application\/xhtml/i.test(contentType) &&
      isLikelyHtmlResponse(buffer)
    ) {
      throw new Error('Response is HTML, not a PDF')
    }

    return {
      buffer,
      contentType,
      finalUrl: response.url || url,
      httpStatus: response.status,
    }
  } finally {
    clearTimeout(timer)
  }
}

export default { fetchBinary, isLikelyHtmlResponse }
