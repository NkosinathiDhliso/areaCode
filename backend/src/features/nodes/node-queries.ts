// Node query operations — reads, search, trending
import { AppError } from '../../shared/errors/AppError.js'
import { kvGet } from '../../shared/kv/dynamodb-kv.js'
import * as repo from './repository.js'

// ─── State Thresholds ───────────────────────────────────────────────────────

const STATE_THRESHOLDS = [
  { min: 61, state: 'popping' as const },
  { min: 31, state: 'buzzing' as const },
  { min: 11, state: 'active' as const },
  { min: 1, state: 'quiet' as const },
  { min: 0, state: 'dormant' as const },
]

export function getNodeState(score: number): string {
  for (const t of STATE_THRESHOLDS) {
    if (score >= t.min) return t.state
  }
  return 'dormant'
}

// ─── Node Queries ───────────────────────────────────────────────────────────

export async function getNodesByCitySlug(citySlug: string) {
  return repo.getNodesByCitySlug(citySlug)
}

export async function getNodeDetail(nodeId: string) {
  const node = await repo.getNodeById(nodeId)
  if (!node) throw AppError.notFound('Node not found')

  const cityId = node.city?.slug
  let pulseScore = 0
  if (cityId) {
    const score = await kvGet(`pulse:${cityId}:${nodeId}`)
    pulseScore = score ? parseFloat(score) : 0
  }

  return { ...node, pulseScore }
}

export async function getNodePublic(nodeSlug: string) {
  const node = await repo.getNodeBySlug(nodeSlug)
  if (!node) throw AppError.notFound('Node not found')

  return {
    name: node.name,
    category: node.category,
    city: node.city?.name ?? null,
    pulseScore: 0,
    activeRewardCount: node.rewards.length,
    ogImage: null,
  }
}

export async function searchNodes(query: string, lat: number, lng: number) {
  if (query.length < 2) throw AppError.badRequest('Query must be at least 2 characters')
  return repo.searchNodes(query, lat, lng)
}

// ─── Trending Nodes ─────────────────────────────────────────────────────────

interface TrendingItem {
  name: string
  area: string
  state: string
  checkIns: number
  nodeId: string
  slug: string
  category: string
  lat: number
  lng: number
}

const CITY_SLUGS = ['johannesburg', 'cape-town', 'durban']

export async function getTrendingNodes(limit = 10): Promise<{ items: TrendingItem[] }> {
  const cityResults = await Promise.all(
    CITY_SLUGS.map(async (slug) => {
      const city = await repo.getCityBySlug(slug)
      if (!city) return []
      const nodes = await repo.getNodesByCitySlug(slug)
      return nodes.map((n: Record<string, unknown>) => ({
        ...n,
        cityName: city.name,
        cityId: city.id,
      }))
    }),
  )

  const allNodes = cityResults.flat()

  const scored = await Promise.all(
    allNodes.map(async (node: Record<string, unknown>) => {
      const nodeId = (node['id'] ?? node['nodeId']) as string
      const cityId = node['cityId'] as string
      let pulseScore = 0
      try {
        const score = await kvGet(`pulse:${cityId}:${nodeId}`)
        pulseScore = score ? parseFloat(score) : 0
      } catch {
        // KV lookup failed, default to 0
      }
      return { node, pulseScore }
    }),
  )

  const trending = scored
    .filter((s) => s.pulseScore > 0)
    .sort((a, b) => b.pulseScore - a.pulseScore)
    .slice(0, limit)

  return {
    items: trending.map((s) => ({
      name: s.node['name'] as string,
      area: s.node['cityName'] as string,
      state: getNodeState(s.pulseScore),
      checkIns: Math.ceil(s.pulseScore / 5),
      nodeId: (s.node['id'] ?? s.node['nodeId']) as string,
      slug: (s.node['slug'] ?? '') as string,
      category: (s.node['category'] ?? 'default') as string,
      lat: (s.node['lat'] ?? 0) as number,
      lng: (s.node['lng'] ?? 0) as number,
    })),
  }
}

// ─── Who Is Here ────────────────────────────────────────────────────────────

export async function getWhoIsHere(nodeId: string, limit: number) {
  return repo.getWhoIsHere(nodeId, limit)
}

// ─── Node Rewards ───────────────────────────────────────────────────────────

export async function getNodeRewards(nodeId: string) {
  const { getActiveRewardsByNodeId } = await import('../rewards/dynamodb-repository.js')
  const rewards = await getActiveRewardsByNodeId(nodeId)
  return { items: rewards }
}
