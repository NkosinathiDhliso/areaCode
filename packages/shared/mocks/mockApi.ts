/**
 * Patches the shared ApiClient singleton to route through the mock router.
 * Replaces the private `request` method so all get/post/put/patch/delete calls
 * are intercepted transparently.
 */
import { api } from '../lib/api'
import { resolve } from './mockRouter'
import { mockDelay } from './helpers'

export function patchApiClient(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(api as any).request = async function <T>(method: string, path: string, body?: unknown): Promise<T> {
    await mockDelay()
    const result = resolve(method, path, body)
    // If result has statusCode >= 400, throw it as an error (mimics real API behavior)
    if (result && typeof result === 'object' && 'statusCode' in result) {
      const r = result as { statusCode: number }
      if (r.statusCode >= 400) throw result
    }
    return result as T
  }
}
