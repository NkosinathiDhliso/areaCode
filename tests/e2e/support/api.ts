/**
 * Tiny HTTP helper used by tests that need to provision data or hit
 * the API directly. Wraps Playwright's request context with a
 * preset Authorization header.
 *
 * If you need a richer client, swap to APIRequest contexts inside the
 * spec rather than growing this file.
 */

import { request as pwRequest, type APIRequestContext } from '@playwright/test'

import { getIdToken } from './auth-token.js'
import { URLS, type AccountKey } from './env.js'

export async function apiAs(account: AccountKey): Promise<APIRequestContext> {
  const token = await getIdToken(account)
  return await pwRequest.newContext({
    baseURL: URLS.api(),
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  })
}

export async function apiAnonymous(): Promise<APIRequestContext> {
  return await pwRequest.newContext({ baseURL: URLS.api() })
}
