/**
 * @fileoverview Minimal HTTP helper for research-source connectors (native fetch).
 */
import {
  ConnectorTimeoutError,
  ConnectorRateLimitError,
  ConnectorInvalidResponseError,
  ConnectorUnavailableError,
} from './connectorError.js'

/**
 * @typedef {object} ConnectorHttpOptions
 * @property {string} source
 * @property {number} [timeoutMs]
 * @property {Record<string, string>} [headers]
 */

/**
 * Perform a JSON GET request for a connector.
 *
 * @param {string} url
 * @param {ConnectorHttpOptions} options
 * @returns {Promise<unknown>}
 */
export async function connectorGetJson(url, options) {
  const { source, timeoutMs = 20000, headers = {} } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      signal: controller.signal,
    })

    if (response.status === 401 || response.status === 403) {
      throw new ConnectorInvalidResponseError(
        'Research source authentication failed',
        {
          source,
          details: { status: response.status },
        }
      )
    }

    if (response.status === 404) {
      throw new ConnectorInvalidResponseError(
        'Requested resource was not found on the research source',
        {
          source,
          details: { status: 404 },
        }
      )
    }

    if (response.status === 429) {
      throw new ConnectorRateLimitError('Research source rate limit exceeded', {
        source,
        statusCode: 429,
      })
    }

    if (response.status >= 500) {
      throw new ConnectorUnavailableError('Research source is unavailable', {
        source,
        statusCode: response.status,
      })
    }

    if (!response.ok) {
      throw new ConnectorInvalidResponseError(
        `Research source returned HTTP ${response.status}`,
        {
          source,
          details: { status: response.status },
        }
      )
    }

    try {
      return await response.json()
    } catch (cause) {
      throw new ConnectorInvalidResponseError(
        'Research source returned invalid JSON',
        { source, cause }
      )
    }
  } catch (error) {
    if (
      error instanceof ConnectorRateLimitError ||
      error instanceof ConnectorInvalidResponseError ||
      error instanceof ConnectorUnavailableError ||
      error instanceof ConnectorTimeoutError
    ) {
      throw error
    }

    if (error?.name === 'AbortError') {
      throw new ConnectorTimeoutError('Research source request timed out', {
        source,
        cause: error,
      })
    }

    throw new ConnectorUnavailableError('Research source is unavailable', {
      source,
      cause: error,
    })
  } finally {
    clearTimeout(timer)
  }
}
