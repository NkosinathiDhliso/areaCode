/**
 * Unit tests for `GET /v1/share/node/:slug` — the Share_Preview route on the
 * existing API Lambda (proof-of-demand R1.2, R12.2, R12.3).
 *
 * The route is exercised end to end through its real preHandler chain (slug
 * validation, then the shared public-venue rate limiter) and the real service
 * and snapshot builder, with only the repository, the KV store and env config
 * mocked. So these tests cover:
 *
 *  - the document is served as HTML with `Cache-Control: public, max-age=300`
 *    and a CSP whose nonce matches the one inline redirect
 *  - the `og:description` is the live snapshot line, built from the pulse KV key
 *    the venue detail reads and the presence live count in epoch seconds
 *    (R1.4, R15.4), and `og:image` is the venue header image on the Media_CDN,
 *    falling back to the site default
 *  - an unknown slug is a 404, not an empty preview
 *  - a slug that is not slug-shaped is rejected at the boundary (400), so
 *    nothing hostile ever reaches the HTML
 *  - the route is public (no auth preHandler) and rate limited on the same key
 *    the public node route uses
 *
 * _Requirements: 1.2, 12.2, 12.3_
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getNodeBySlug: vi.fn(),
  kvGet: vi.fn(),
  kvIncr: vi.fn(),
  kvTtl: vi.fn(),
  mediaCdnBaseUrl: vi.fn(),
  getLivePresenceCount: vi.fn(),
}))

vi.mock('../../../shared/config/env.js', () => ({
  DEV_MODE: false,
  APP_ENV: 'test',
  IS_PROD: false,
  AWS_REGION: 'af-south-1',
  requireEnv: (_name: string, devDefault?: string) => devDefault ?? 'test-value',
  webBaseUrl: () => 'https://areacode.co.za',
  mediaCdnBaseUrl: mocks.mediaCdnBaseUrl,
}))

vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({
  kvGet: mocks.kvGet,
  kvSet: vi.fn(),
  kvDel: vi.fn(),
  kvBatchGet: vi.fn(),
  kvIncr: mocks.kvIncr,
  kvTtl: mocks.kvTtl,
}))

vi.mock('../repository.js', () => ({
  getNodeBySlug: mocks.getNodeBySlug,
}))

// The public venue read also counts Going marks (R9.2). No marks here: this
// suite is about the preview document, and the count never reaches it.
vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: vi.fn(async () => ({ Count: 0 })) },
  TableNames: { appData: 'area-code-test-app-data' },
}))

vi.mock('../../presence/repository.js', () => ({
  getLivePresenceCount: mocks.getLivePresenceCount,
  getMomentum: vi.fn(),
}))

import type { FastifyInstance } from 'fastify'

import { PUBLIC_NODE_RATE_LIMIT } from '../rate-limits.js'
import { nodeShareRoutes } from '../share-routes.js'

// ─── Fastify test harness ────────────────────────────────────────────────────

type RouteHandler = (request: unknown, reply: unknown) => unknown | Promise<unknown>
type PreHandler = (request: unknown, reply: unknown) => unknown | Promise<unknown>

interface CapturedRoute {
  url: string
  opts: { preHandler: PreHandler[] }
  handler: RouteHandler
}

async function getRoute(): Promise<CapturedRoute> {
  const routes: CapturedRoute[] = []
  const app = {
    get: (url: string, opts: { preHandler: PreHandler[] }, handler: RouteHandler) => {
      routes.push({ url, opts, handler })
    },
  } as unknown as FastifyInstance
  await nodeShareRoutes(app)
  const route = routes.find((r) => r.url === '/v1/share/node/:slug')
  if (!route) throw new Error('share route not registered')
  return route
}

function makeReply() {
  const state: { contentType?: string; headers: Record<string, string>; body?: unknown } = { headers: {} }
  const reply = {
    type(ct: string) {
      state.contentType = ct
      return reply
    },
    header(name: string, value: string) {
      state.headers[name] = value
      return reply
    },
    send(body: unknown) {
      state.body = body
      return reply
    },
  }
  return { reply, state }
}

/** Run the real preHandler chain, then the handler, as Fastify would. */
async function request(slug: string) {
  const route = await getRoute()
  const { reply, state } = makeReply()
  const req = { params: { slug }, ip: '203.0.113.9' }
  for (const pre of route.opts.preHandler) await pre(req, reply)
  await route.handler(req, reply)
  return { ...state, html: String(state.body) }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SLUG = 'ramonas-a1b2c3'
const NODE_ID = 'node-ramonas'
const PULSE_KEY = `pulse:johannesburg:${NODE_ID}`

function repoNode(overrides: Record<string, unknown> = {}) {
  return {
    id: NODE_ID,
    name: "Ramona's",
    category: 'nightlife',
    lat: -26.2041,
    lng: 28.0473,
    city: { name: 'Johannesburg', slug: 'johannesburg' },
    headerImageKey: 'nodes/n1/header.webp',
    rewards: [{ id: 'r1' }],
    ...overrides,
  }
}

beforeEach(() => {
  mocks.getNodeBySlug.mockReset()
  // Default: no pulse key and nobody present — the honest empty venue.
  mocks.kvGet.mockReset().mockResolvedValue(null)
  mocks.getLivePresenceCount.mockReset().mockResolvedValue(0)
  mocks.kvIncr.mockReset().mockResolvedValue(1)
  mocks.kvTtl.mockReset().mockResolvedValue(60)
  mocks.mediaCdnBaseUrl.mockReset().mockReturnValue('https://cdn.areacode.co.za')
})

// ─── Response shape ──────────────────────────────────────────────────────────

describe('GET /v1/share/node/:slug — response (R1.2, task 1.3)', () => {
  it('serves HTML cached publicly for five minutes', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode())

    const res = await request(SLUG)

    expect(res.contentType).toBe('text/html; charset=utf-8')
    expect(res.headers['Cache-Control']).toBe('public, max-age=300')
    expect(res.html.startsWith('<!doctype html>')).toBe(true)
  })

  it('sets a document CSP whose nonce matches the inline redirect', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode())

    const res = await request(SLUG)

    const nonce = /<script nonce="([^"]+)">/.exec(res.html)?.[1]
    expect(nonce).toBeTruthy()
    expect(res.headers['Content-Security-Policy']).toContain(`script-src 'nonce-${nonce}'`)
  })

  it('redirects into the map with the share source preserved (R12.3)', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode())

    const res = await request(SLUG)

    expect(res.html).toContain(`location.replace("/map?venue=${SLUG}&src=share")`)
    expect(res.html).toContain(`<a href="/map?venue=${SLUG}&amp;src=share">`)
  })
})

// ─── Resolved venue fields ───────────────────────────────────────────────────

describe('GET /v1/share/node/:slug — venue fields (R1.2)', () => {
  it('describes the venue with the live snapshot line and links it canonically', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode())
    mocks.kvGet.mockResolvedValue('45')
    mocks.getLivePresenceCount.mockResolvedValue(12)

    const res = await request(SLUG)

    expect(res.html).toContain('<meta property="og:title" content="Ramona&#39;s" />')
    expect(res.html).toContain(
      '<meta property="og:description" content="Ramona&#39;s \u00b7 Buzzing \u00b7 12 here now \u00b7 1 get live" />',
    )
    expect(res.html).toContain('<meta property="og:url" content="https://areacode.co.za/node/ramonas-a1b2c3" />')
  })

  it('reads pulse from the same KV key as the venue detail (R1.4)', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode())
    mocks.kvGet.mockResolvedValue('45')

    await request(SLUG)

    expect(mocks.kvGet).toHaveBeenCalledWith(PULSE_KEY)
  })

  it('reads the live count from presence in epoch seconds (R15.4)', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode())
    const before = Math.floor(Date.now() / 1000)

    await request(SLUG)

    expect(mocks.getLivePresenceCount).toHaveBeenCalledTimes(1)
    const [nodeId, now] = mocks.getLivePresenceCount.mock.calls[0]!
    expect(nodeId).toBe(NODE_ID)
    // Seconds, not milliseconds: within a second or two of the call.
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(before + 2)
  })

  it('reads an absent pulse key and empty venue as zero, honestly', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode())

    const res = await request(SLUG)

    expect(res.html).toContain('<meta property="og:description" content="Ramona&#39;s \u00b7 Be the first in')
  })

  it('never reads as busy when pulse lingers but nobody is there', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode())
    mocks.kvGet.mockResolvedValue('80')
    mocks.getLivePresenceCount.mockResolvedValue(0)

    const res = await request(SLUG)

    expect(res.html).toContain('Quiet right now')
    expect(res.html).not.toContain('Popping')
  })

  it('uses the venue header image on the Media_CDN when one is set', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode())

    const res = await request(SLUG)

    expect(res.html).toContain('<meta property="og:image" content="https://cdn.areacode.co.za/nodes/n1/header.webp" />')
  })

  it('uses the site default image when the venue has no header image', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode({ headerImageKey: null }))

    const res = await request(SLUG)

    expect(res.html).toContain('<meta property="og:image" content="https://www.areacode.co.za/og-image.png" />')
  })

  it('escapes a hostile venue name instead of rendering it', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode({ name: `Bob's "Bar" <script>alert(1)</script>` }))

    const res = await request(SLUG)

    expect(res.html).not.toContain('<script>alert(1)</script>')
    expect(res.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(res.html.match(/<script/g)).toHaveLength(1)
  })
})

// ─── Failure and boundary behaviour ──────────────────────────────────────────

describe('GET /v1/share/node/:slug — boundaries (R12.2)', () => {
  it('404s an unknown slug rather than serving an empty preview', async () => {
    mocks.getNodeBySlug.mockResolvedValue(null)

    await expect(request('no-such-venue')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects a slug that is not slug-shaped before any read', async () => {
    await expect(request('bad slug"<script>')).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.getNodeBySlug).not.toHaveBeenCalled()
  })

  it('rate limits on the same key as the public node route', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode())

    await request(SLUG)

    expect(mocks.kvIncr).toHaveBeenCalledWith(
      `ratelimit:${PUBLIC_NODE_RATE_LIMIT.key}:203.0.113.9`,
      PUBLIC_NODE_RATE_LIMIT.windowSeconds,
    )
  })

  it('returns 429 once the shared budget is spent', async () => {
    mocks.getNodeBySlug.mockResolvedValue(repoNode())
    mocks.kvIncr.mockResolvedValue(PUBLIC_NODE_RATE_LIMIT.max + 1)

    await expect(request(SLUG)).rejects.toMatchObject({ statusCode: 429 })
  })

  it('is public: the route registers no auth preHandler', async () => {
    const route = await getRoute()
    // Two preHandlers only: validation, then the rate limiter.
    expect(route.opts.preHandler).toHaveLength(2)
  })
})
