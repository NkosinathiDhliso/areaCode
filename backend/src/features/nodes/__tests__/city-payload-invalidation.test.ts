/**
 * City_Nodes_Read cache invalidation (proof-of-demand R15.5).
 *
 * `getNodesByCitySlug` serves an assembled payload from KV for 45 seconds, so a
 * write that changes what the map shows and does NOT drop that entry is a change
 * an owner watches fail. Two layers here:
 *
 *  1. Behaviour of `invalidateCityPayloadForNode`, the node-keyed entry point:
 *     node -> cityId -> slug -> `kvDel(nodes:city:{slug})`, with its own failure
 *     logged rather than thrown (a cache key is never worth failing a save for).
 *  2. An enumeration over every write that changes the map, asserting each one
 *     calls an invalidation helper. This is the layer that catches the NEXT
 *     write someone adds without wiring it, which is how the defect happened.
 *
 * **Validates: Requirements 15.5**
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  kvDel: vi.fn(),
  getNodeById: vi.fn(),
  getNodesByBusinessId: vi.fn(),
  getCityById: vi.fn(),
}))

vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({ kvDel: mocks.kvDel }))

vi.mock('../dynamodb-repository.js', () => ({
  getNodeById: mocks.getNodeById,
  getNodesByBusinessId: mocks.getNodesByBusinessId,
}))

vi.mock('../repository.js', () => ({ getCityById: mocks.getCityById }))

import { cityPayloadCacheKey, invalidateCityPayloadForNode } from '../cache.js'

const NODE_ID = 'node-1'
const CITY_ID = 'city-jhb'
const CITY_SLUG = 'johannesburg'

beforeEach(() => {
  mocks.kvDel.mockReset().mockResolvedValue(undefined)
  mocks.getNodeById.mockReset()
  mocks.getNodesByBusinessId.mockReset()
  mocks.getCityById.mockReset()
})

describe('invalidateCityPayloadForNode (R15.5)', () => {
  it('resolves the node city and deletes that city payload key', async () => {
    mocks.getNodeById.mockResolvedValue({ nodeId: NODE_ID, cityId: CITY_ID })
    mocks.getCityById.mockResolvedValue({ id: CITY_ID, slug: CITY_SLUG, name: 'Johannesburg' })

    await invalidateCityPayloadForNode(NODE_ID)

    expect(mocks.kvDel).toHaveBeenCalledTimes(1)
    expect(mocks.kvDel).toHaveBeenCalledWith(cityPayloadCacheKey(CITY_SLUG))
  })

  it('deletes nothing when the node has no city', async () => {
    mocks.getNodeById.mockResolvedValue({ nodeId: NODE_ID, cityId: null })

    await invalidateCityPayloadForNode(NODE_ID)

    expect(mocks.kvDel).not.toHaveBeenCalled()
  })

  it('deletes nothing when the city row is missing', async () => {
    mocks.getNodeById.mockResolvedValue({ nodeId: NODE_ID, cityId: CITY_ID })
    mocks.getCityById.mockResolvedValue(null)

    await invalidateCityPayloadForNode(NODE_ID)

    expect(mocks.kvDel).not.toHaveBeenCalled()
  })

  it('logs and swallows a lookup failure instead of failing the write that called it', async () => {
    mocks.getNodeById.mockRejectedValue(new Error('nodes table throttled'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(invalidateCityPayloadForNode(NODE_ID)).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(String(errSpy.mock.calls[0]![0])).toContain(NODE_ID)

    errSpy.mockRestore()
  })
})

// ─── Enumeration: every write that changes the map invalidates ───────────────

const FEATURES = join(process.cwd(), 'backend', 'src', 'features')

function sourceOf(relativePath: string): string {
  return readFileSync(join(FEATURES, relativePath), 'utf8')
}

/**
 * The body of a named function, by brace balance from its declaration. Used
 * instead of a whole-file search so a helper wired in one function cannot make
 * the assertion pass for a sibling that forgot it.
 */
function functionBody(source: string, name: string): string {
  const declaration = new RegExp(`(?:export )?async function ${name}\\b`).exec(source)
  expect(declaration, `function not found: ${name}`).not.toBeNull()

  // Skip the parameter list before looking for the body brace: a parameter typed
  // `Partial<{ ... }>` would otherwise be mistaken for the body.
  let index = source.indexOf('(', declaration!.index)
  let parens = 0
  for (; index < source.length; index++) {
    if (source[index] === '(') parens++
    else if (source[index] === ')') {
      parens--
      if (parens === 0) break
    }
  }

  // Then skip the return-type annotation: `Promise<{ ... }>` also opens a brace,
  // so the body is the first brace outside any angle brackets.
  let angles = 0
  let start = -1
  for (let i = index; i < source.length; i++) {
    const char = source[i]
    if (char === '<') angles++
    else if (char === '>' && source[i - 1] !== '=') angles--
    else if (char === '{' && angles === 0) {
      start = i
      break
    }
  }
  expect(start, `body not found for ${name}`).toBeGreaterThan(-1)

  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return source.slice(start)
}

/** Each `app.<verb>(` block in a route module, keyed by the route path it declares. */
function routeBlock(source: string, routePath: string): string {
  const blocks = source.split(/\n {2}app\./)
  const block = blocks.find((candidate) => candidate.includes(`'${routePath}'`))
  expect(block, `route not found: ${routePath}`).toBeDefined()
  return block!
}

/** Writes that change what the consumer map shows, and where they live. */
const NODE_SCOPED_WRITES: Array<[file: string, fn: string]> = [
  // Venue create, edit, social links, and the abuse auto-flag that hides a venue.
  ['nodes/service.ts', 'businessCreateNode'],
  ['nodes/service.ts', 'createNode'],
  ['nodes/service.ts', 'updateNode'],
  ['nodes/service.ts', 'updateNodeSocialLinks'],
  ['nodes/service.ts', 'reportNode'],
  // A published or deactivated get changes the venue's map read.
  ['rewards/service.ts', 'createReward'],
  ['rewards/service.ts', 'updateReward'],
  // Admin node activation, deactivation and edit.
  ['admin/service.ts', 'nodeAction'],
  // Tier and membership: comp, disable cascade, grace demotion, paid activation,
  // and the Yoco boost window.
  ['admin/service.ts', 'setBusinessTier'],
  ['admin/service.ts', 'disableBusiness'],
  ['business/service.ts', 'deactivateForNonPayment'],
  ['business/service.ts', 'persistSubscriptionPayment'],
  ['business/service.ts', 'persistBoosterPurchase'],
  // Tonight (R8.5): a published slot has to reach the map on the next request.
  ['music/schedule-service.ts', 'upsertScheduleForBusiness'],
  ['music/schedule-service.ts', 'deleteScheduleSlotForBusiness'],
]

/** Header image writes, which live on the route rather than in a service. */
const IMAGE_ROUTES = [
  '/v1/business/nodes/:nodeId/image/upload-url',
  '/v1/business/nodes/:nodeId/image/process',
  '/v1/business/nodes/:nodeId/image',
]

describe('every map-changing write invalidates the city payload (R15.5)', () => {
  it.each(NODE_SCOPED_WRITES)('%s %s calls an invalidation helper', (file, fn) => {
    const body = functionBody(sourceOf(file), fn)
    // `invalidateMapForBusiness` is the business service's one-line wrapper
    // around the business-scoped helper (asserted below), not a second home.
    expect(body).toMatch(/invalidate(CityPayload|MapForBusiness)/)
  })

  it('routes the business service wrapper at the one shared helper', () => {
    const body = functionBody(sourceOf('business/service.ts'), 'invalidateMapForBusiness')
    expect(body).toContain('invalidateCityPayloadForBusiness')
    expect(body).toContain("'../nodes/cache.js'")
  })

  it.each(IMAGE_ROUTES)('the %s route calls an invalidation helper', (routePath) => {
    const block = routeBlock(sourceOf('nodes/image-routes.ts'), routePath)
    expect(block).toContain('invalidateCityPayloadForNode')
  })

  it('keeps the invalidation helpers in one home', () => {
    // One module owns the key shape and both entry points. A second helper
    // elsewhere would be the duplicate this rule exists to prevent
    // (`dry-reuse-no-duplication.md`).
    const cache = sourceOf('nodes/cache.ts')
    expect(cache).toContain('export function cityPayloadCacheKey')
    expect(cache).toContain('export async function invalidateCityPayload')
    expect(cache).toContain('export async function invalidateCityPayloadForNode')
    expect(cache).toContain('export async function invalidateCityPayloadForBusiness')
  })
})
