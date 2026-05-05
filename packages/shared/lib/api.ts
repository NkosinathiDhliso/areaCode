const API_BASE_URL =
  typeof import.meta !== 'undefined'
    ? ((import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_API_URL ?? 'http://localhost:4000')
    : 'http://localhost:4000'

// Error toast handler — wired at app startup via setApiErrorHandler()
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}

    // Only set Content-Type when we actually have a body — otherwise Fastify
    // rejects body-less POST/PATCH with 400 'Body cannot be empty when content-type is application/json'.
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json'
    }

    const token = this.getToken?.()
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
      if ((err as Error).name === 'AbortError') {
        const error = {
          error: 'timeout',
          message: 'Request timed out. Check your connection.',
          statusCode: 0,
        } as ApiError
        getShowError()?.('Request timed out. Check your connection.')
        throw error
      }
      const error = {
        error: 'network',
        message: 'Unable to connect. Check your connection.',
        statusCode: 0,
      } as ApiError
      getShowError()?.('Unable to connect. Check your connection.')
      throw error
    } finally {
      clearTimeout(timeout)
    }

    // On 401, try refreshing the token once
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
      const error: ApiError = await response.json().catch(() => ({
        error: 'unknown',
        message: response.statusText,
        statusCode: response.status,
      }))
      // Show toast for server errors (5xx)
      if (response.status >= 500) {
        getShowError()?.(error.message || 'Something went wrong. Please try again.')
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
