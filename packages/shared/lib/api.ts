/**
 * Resolve the API base URL across platforms.
 *
 * Web (Vite): `import.meta.env.VITE_API_URL`.
 * React Native (Expo): `process.env.EXPO_PUBLIC_API_URL` (inlined by Expo at
 *   build time). `import.meta` is not available in the RN runtime, so the
 *   guarded access below falls through to the process.env branch.
 *
 * Falls back to localhost for local dev. The native app may also call
 * `api.setBaseUrl()` at boot to override this from `expo-constants` extra.
 */
import { ERROR_COPY } from '../constants/error-copy'

function resolveApiBaseUrl(): string {
  try {
    if (typeof import.meta !== 'undefined') {
      const env = (import.meta as unknown as Record<string, Record<string, string>>).env
      if (env?.VITE_API_URL) return env.VITE_API_URL
    }
  } catch {
    // `import.meta` access throws in some non-ESM/RN contexts - ignore.
  }
  // React Native (Expo): reach for `process` via `globalThis` so this module
  // compiles under the web tsconfig, which omits `@types/node` and would
  // otherwise raise TS2591 on a bare `process` reference. The web bundle never
  // takes this branch at runtime because `process` is undefined there.
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  const fromExpo = proc?.env?.['EXPO_PUBLIC_API_URL']
  if (fromExpo) return fromExpo
  return 'http://localhost:4000'
}

const API_BASE_URL = resolveApiBaseUrl()

// One automatic retry for transient failures on idempotent reads (GET).
// Lambda cold starts, brief DynamoDB throttling, and dropped connections are
// the common causes of a random 5xx; retrying once after a short backoff
// resolves most of them before the user ever sees an error.
const RETRYABLE_METHODS = new Set(['GET'])
const RETRY_BACKOFF_MS = 400
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Error toast handler - wired at app startup via setApiErrorHandler()
let _showError: ((msg: string) => void) | null = null
function getShowError() {
  return _showError
}

/** Call once at app startup to wire the error toast into the API client */
export function setApiErrorHandler(handler: (msg: string) => void) {
  _showError = handler
}

interface ApiError {
  error: string
  message: string
  statusCode: number
}

// ─── JWT expiry helpers ──────────────────────────────────────────────────────
// Decode the payload of a JWT without verification (we only need `exp`).
// This avoids importing a full JWT library on the client.
function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    // Base64url → Base64 → decode
    const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(payload)
    const parsed = JSON.parse(json) as { exp?: number }
    return typeof parsed.exp === 'number' ? parsed.exp : null
  } catch {
    return null
  }
}

/** Returns true when the token will expire within `bufferSeconds` (default 60). */
function isTokenExpiringSoon(token: string | null, bufferSeconds = 60): boolean {
  if (!token) return true
  const exp = decodeJwtExp(token)
  if (exp === null) return false // Can't determine - assume valid
  return Date.now() / 1000 >= exp - bufferSeconds
}

// ─── Token refresh listeners ─────────────────────────────────────────────────
// External code (e.g. WebSocket manager) can subscribe to token refreshes.
type TokenRefreshListener = (newToken: string) => void
const tokenRefreshListeners: Set<TokenRefreshListener> = new Set()

/** Subscribe to token refresh events. Returns an unsubscribe function. */
export function onTokenRefresh(listener: TokenRefreshListener): () => void {
  tokenRefreshListeners.add(listener)
  return () => {
    tokenRefreshListeners.delete(listener)
  }
}

class ApiClient {
  private baseUrl: string
  private getToken: (() => string | null) | null = null
  private getRefreshToken: (() => string | null) | null = null
  private onTokenRefreshed: ((token: string) => void) | null = null
  private onAuthExpired: (() => void) | null = null
  private refreshing: Promise<string | null> | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  setTokenProvider(provider: () => string | null) {
    this.getToken = provider
  }

  /**
   * Override the base URL at runtime. Used by the React Native app to set the
   * API origin from `expo-constants` extra when the build-time env var isn't
   * available. No-op-safe to call before any request.
   */
  setBaseUrl(url: string) {
    if (url) this.baseUrl = url
  }

  setRefreshHandler(opts: {
    getRefreshToken: () => string | null
    onTokenRefreshed: (token: string) => void
    onAuthExpired: () => void
  }) {
    this.getRefreshToken = opts.getRefreshToken
    this.onTokenRefreshed = opts.onTokenRefreshed
    this.onAuthExpired = opts.onAuthExpired
  }

  private refreshPath = '/v1/auth/consumer/refresh'

  setRefreshPath(path: string) {
    this.refreshPath = path
  }

  private async tryRefreshToken(): Promise<string | null> {
    if (this.refreshing) return this.refreshing

    const refreshToken = this.getRefreshToken?.()
    if (!refreshToken) return null

    this.refreshing = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}${this.refreshPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        })
        if (!res.ok) return null
        const data = (await res.json()) as { accessToken?: string }
        if (data.accessToken) {
          this.onTokenRefreshed?.(data.accessToken)
          // Notify external listeners (WebSocket, etc.)
          for (const listener of tokenRefreshListeners) {
            try {
              listener(data.accessToken)
            } catch {
              /* swallow */
            }
          }
          return data.accessToken
        }
        return null
      } catch {
        return null
      } finally {
        this.refreshing = null
      }
    })()

    return this.refreshing
  }

  /**
   * Ensure the current access token is valid (not expired or expiring soon).
   * If it's stale, proactively refresh before returning. Returns the valid
   * token or null if refresh failed (session dead).
   *
   * Call this at app boot before firing initial API requests or connecting
   * the WebSocket to avoid the 401-then-retry noise.
   */
  async ensureValidToken(): Promise<string | null> {
    const token = this.getToken?.() ?? null
    if (!isTokenExpiringSoon(token)) return token

    // Token is expired or about to expire - refresh proactively
    if (this.getRefreshToken) {
      const newToken = await this.tryRefreshToken()
      if (newToken) return newToken
      // Refresh failed - session is dead
      this.onAuthExpired?.()
      return null
    }
    return token
  }

  private async request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const headers: Record<string, string> = {}

    // Only set Content-Type when we actually have a body - otherwise Fastify
    // rejects body-less POST/PATCH with 400 'Body cannot be empty when content-type is application/json'.
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json'
    }

    // Proactive refresh: if the token is expiring within 60s, refresh BEFORE
    // sending the request. This eliminates the 401 → refresh → retry round-trip.
    let token: string | null = this.getToken?.() ?? null
    if (isTokenExpiringSoon(token) && this.getRefreshToken) {
      const refreshed = await this.tryRefreshToken()
      if (refreshed) {
        token = refreshed
      } else {
        // Refresh failed - let the request go with the stale token so the
        // 401 path below can trigger onAuthExpired cleanly.
      }
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    // 15 second timeout for all requests
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      const canRetry = RETRYABLE_METHODS.has(method) && attempt === 0
      // Transient failure on an idempotent read — retry once before giving up.
      if (canRetry) {
        await delay(RETRY_BACKOFF_MS)
        return this.request<T>(method, path, body, attempt + 1)
      }
      // Connectivity failures (offline, DNS, timeout) are self-evident — the
      // user can see their connection is down. We do NOT toast these; we just
      // throw so a screen that needs to can render its own inline state.
      if ((err as Error).name === 'AbortError') {
        throw {
          error: 'timeout',
          message: ERROR_COPY.timeout,
          statusCode: 0,
        } as ApiError
      }
      throw {
        error: 'network',
        message: ERROR_COPY.network,
        statusCode: 0,
      } as ApiError
    } finally {
      clearTimeout(timeout)
    }

    // On 401, try refreshing the token once (fallback for edge cases where
    // proactive refresh didn't fire, e.g. clock skew)
    if (response.status === 401 && this.getRefreshToken) {
      const newToken = await this.tryRefreshToken()
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`
        const retry = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : null,
        })
        if (retry.ok) {
          if (retry.status === 204) return undefined as T
          return retry.json() as Promise<T>
        }
      }
      // Refresh failed, session is dead
      this.onAuthExpired?.()
    }

    if (!response.ok) {
      // Retry transient server errors once on idempotent reads, before we even
      // parse the body, to absorb Lambda cold starts / brief throttling.
      if (response.status >= 500 && RETRYABLE_METHODS.has(method) && attempt === 0) {
        await delay(RETRY_BACKOFF_MS)
        return this.request<T>(method, path, body, attempt + 1)
      }
      const error: ApiError = await response.json().catch(() => ({
        error: 'unknown',
        message: response.statusText,
        statusCode: response.status,
      }))
      // Server-side failure (5xx). Never surface the raw backend text (e.g.
      // "Internal server error"). Use the reassuring, approved copy on both the
      // toast and the thrown error so no downstream handler can leak it either.
      if (response.status >= 500) {
        error.message = ERROR_COPY.serverError
        getShowError()?.(ERROR_COPY.serverError)
      }
      throw error
    }

    // Handle 204 No Content (e.g. DELETE operations)
    if (response.status === 204) return undefined as T

    return response.json() as Promise<T>
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }
}

export const api = new ApiClient(API_BASE_URL)
export type { ApiError }
