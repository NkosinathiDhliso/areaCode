/**
 * Origin guard for state-changing endpoints that don't already require
 * a Bearer token.
 *
 * Refresh-token endpoints are the canonical case: the client posts a
 * refresh token (no auth header), and we exchange it for a fresh access
 * token. A malicious page could in principle try to do the same, so we
 * reject any refresh request whose Origin doesn't match our allowlist.
 *
 * This is a belt-and-braces defence — refresh tokens live in
 * localStorage, so an XSS already lets the attacker steal them. But the
 * Origin check costs nothing and stops the cheap CSRF case.
 */

import type { FastifyReply, FastifyRequest } from 'fastify'

import { AppError } from '../errors/AppError.js'
import { isAllowedOrigin } from '../security/origins.js'

export async function originGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const origin = request.headers.origin
  if (!isAllowedOrigin(origin)) {
    throw AppError.forbidden('origin_not_allowed')
  }
}
