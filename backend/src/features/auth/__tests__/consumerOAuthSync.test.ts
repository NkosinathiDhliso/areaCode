import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

/**
 * Identity resolution for consumer Google sign-in (`consumerOAuthSync`).
 *
 * Mirrors the branch logic in `service.ts`: look up by the authenticated sub,
 * then fall back to the verified email. A row found by email that carries a
 * *different* sub is a v1->v2 migration leftover (one email = one sub inside the
 * live pool), so it must be re-linked, never rejected with a 409.
 *
 * Feature: consumer-oauth-sync, Property 1: a verified email never strands its
 * own account on a stale Cognito sub.
 */

type Row = { userId: string; cognitoSub?: string }
type Resolution =
  | { action: 'login'; userId: string }
  | { action: 'relink'; userId: string; from: string; to: string }
  | { action: 'adopt'; userId: string; to: string }
  | { action: 'create'; sub: string }

function resolveConsumerIdentity(
  newSub: string,
  email: string,
  bySub: Map<string, Row>,
  byEmail: Map<string, Row>,
): Resolution {
  const direct = bySub.get(newSub)
  if (direct) return { action: 'login', userId: direct.userId }

  const dup = byEmail.get(email)
  if (dup) {
    if (dup.cognitoSub && dup.cognitoSub !== newSub) {
      return { action: 'relink', userId: dup.userId, from: dup.cognitoSub, to: newSub }
    }
    return { action: 'adopt', userId: dup.userId, to: newSub }
  }
  return { action: 'create', sub: newSub }
}

describe('consumerOAuthSync identity resolution', () => {
  it('logs in when the new sub already maps to a row', () => {
    const bySub = new Map<string, Row>([['sub-new', { userId: 'u1', cognitoSub: 'sub-new' }]])
    const byEmail = new Map<string, Row>([['a@x.com', { userId: 'u1', cognitoSub: 'sub-new' }]])
    expect(resolveConsumerIdentity('sub-new', 'a@x.com', bySub, byEmail)).toEqual({
      action: 'login',
      userId: 'u1',
    })
  })

  it('re-links (not 409) when the email row holds a stale v1 sub', () => {
    const bySub = new Map<string, Row>() // new v2 sub not yet linked to any row
    const byEmail = new Map<string, Row>([['a@x.com', { userId: 'u1', cognitoSub: 'sub-v1-old' }]])
    expect(resolveConsumerIdentity('sub-v2-new', 'a@x.com', bySub, byEmail)).toEqual({
      action: 'relink',
      userId: 'u1',
      from: 'sub-v1-old',
      to: 'sub-v2-new',
    })
  })

  it('adopts an orphan row that has no sub', () => {
    const bySub = new Map<string, Row>()
    const byEmail = new Map<string, Row>([['a@x.com', { userId: 'u1' }]])
    expect(resolveConsumerIdentity('sub-v2-new', 'a@x.com', bySub, byEmail)).toEqual({
      action: 'adopt',
      userId: 'u1',
      to: 'sub-v2-new',
    })
  })

  it('creates a fresh account when the email is unknown', () => {
    expect(resolveConsumerIdentity('sub-v2-new', 'new@x.com', new Map(), new Map())).toEqual({
      action: 'create',
      sub: 'sub-v2-new',
    })
  })

  it('never returns a conflict for a verified email whose row holds any other sub', () => {
    const subArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0)
    const userId = 'u1'
    fc.assert(
      fc.property(subArb, subArb, fc.emailAddress(), (oldSub, newSub, email) => {
        fc.pre(oldSub !== newSub)
        const byEmail = new Map<string, Row>([[email, { userId, cognitoSub: oldSub }]])
        // The new sub has no row of its own yet (the migration case).
        const res = resolveConsumerIdentity(newSub, email, new Map(), byEmail)
        expect(res.action).toBe('relink')
        // The account keeps its identity and ends up on the new sub.
        expect(res).toMatchObject({ userId, to: newSub })
      }),
      { numRuns: 100 },
    )
  })
})
