const API_BASE_URL = typeof import.meta !== 'undefined' ? (import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_API_URL ?? 'http://localhost:4000' : 'http://localhost:4000'

interface ApiError {
  error: string
  message: string
  statusCode: number
}

type TokenRefresher = () => Promise<string | null>

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

  private async tryRefreshToken(): Promise<string | null> {
    if (this.refreshing) return this.refreshing

    const refreshToken = this.getRefreshToken?.()
    if (!refreshToken) return null

    this.refreshing = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/v1/auth/consumer/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        })
        if (!res.ok) return null
        const data = await res.json() as { accessToken?: string }
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
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
        throw { error: 'timeout', message: 'Request timed out. Check your connection.', statusCode: 0 } as ApiError
      }
      throw { error: 'network', message: 'Unable to connect. Check your connection.', statusCode: 0 } as ApiError
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
        if (retry.ok) return retry.json() as Promise<T>
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
      throw error
    }

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
