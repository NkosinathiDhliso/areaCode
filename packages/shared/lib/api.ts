const API_BASE_URL = typeof import.meta !== 'undefined' ? (import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_API_URL ?? 'http://localhost:4000' : 'http://localhost:4000'

interface ApiError {
  error: string
  message: string
  statusCode: number
}

class ApiClient {
  private baseUrl: string
  private getToken: (() => string | null) | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  setTokenProvider(provider: () => string | null) {
    this.getToken = provider
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    const token = this.getToken?.()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    })

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
