/**
 * @fileoverview Safe structured JSON extraction / light normalization.
 * Does not invent missing semantic content — only repairs envelope wrappers.
 */

/**
 * Strip common Markdown fences and extract the outermost JSON object/array.
 *
 * @param {string} text
 * @returns {string}
 */
export function extractJsonText(text) {
  if (typeof text !== 'string') {
    throw new Error('Expected string model output')
  }

  let trimmed = text.trim()
  if (!trimmed) throw new Error('Empty model output')

  // ```json ... ``` or ``` ... ```
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) {
    trimmed = fence[1].trim()
  }

  const firstObj = trimmed.indexOf('{')
  const firstArr = trimmed.indexOf('[')
  let start = -1
  if (firstObj === -1) start = firstArr
  else if (firstArr === -1) start = firstObj
  else start = Math.min(firstObj, firstArr)

  if (start === -1) {
    throw new Error('No JSON object found in model output')
  }

  const lastObj = trimmed.lastIndexOf('}')
  const lastArr = trimmed.lastIndexOf(']')
  const end = Math.max(lastObj, lastArr)
  if (end <= start) {
    throw new Error('Malformed JSON boundaries in model output')
  }

  return trimmed.slice(start, end + 1)
}

/**
 * Parse model text into a JSON value with light fence/envelope repair.
 *
 * @param {string} text
 * @returns {unknown}
 */
export function parseStructuredJson(text) {
  const candidate = extractJsonText(text)
  try {
    return JSON.parse(candidate)
  } catch {
    // Minor trailing-comma repair (common model slip)
    const repaired = candidate.replace(/,\s*([}\]])/g, '$1')
    return JSON.parse(repaired)
  }
}

export default {
  extractJsonText,
  parseStructuredJson,
}
