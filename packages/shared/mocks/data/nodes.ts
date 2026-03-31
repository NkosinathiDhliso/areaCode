import type { Node } from '../../types'

/**
 * 12 Johannesburg venue nodes with accurate GPS coordinates.
 * Each node has a non-null businessId linking to a mock business.
 */

const base = {
  cityId: 'jhb',
  claimStatus: 'claimed' as const,
  claimCipcStatus: 'validated' as const,
  isVerified: true,
  isActive: true,
  qrCheckinEnabled: true,
  nodeColour: 'default',
  nodeIcon: null,
  submittedBy: null,
  createdAt: '2026-03-01T00:00:00Z',
} satisfies Partial<Node>

export const MOCK_NODES: Node[] = [
  { ...base, id: 'mock-node-1', name: "Nando's Rosebank", slug: 'nandos-rosebank',
    category: 'food', lat: -26.14565, lng: 28.04325, businessId: 'mock-biz-1' },
  { ...base, id: 'mock-node-2', name: 'Father Coffee', slug: 'father-coffee',
    category: 'coffee', lat: -26.18340, lng: 28.01720, businessId: 'mock-biz-2' },
  { ...base, id: 'mock-node-3', name: "Kitchener's Bar", slug: 'kitcheners-bar',
    category: 'nightlife', lat: -26.19310, lng: 28.03480, businessId: 'mock-biz-3' },
  { ...base, id: 'mock-node-4', name: 'Neighbourgoods Market', slug: 'neighbourgoods-market',
    category: 'food', lat: -26.19250, lng: 28.03350, businessId: 'mock-biz-4' },
  { ...base, id: 'mock-node-5', name: 'Virgin Active Sandton', slug: 'virgin-active-sandton',
    category: 'fitness', lat: -26.10680, lng: 28.05280, businessId: 'mock-biz-5' },
  { ...base, id: 'mock-node-6', name: 'Arts on Main', slug: 'arts-on-main',
    category: 'arts', lat: -26.20480, lng: 28.05650, businessId: 'mock-biz-6' },
  { ...base, id: 'mock-node-7', name: 'Sandton City', slug: 'sandton-city',
    category: 'retail', lat: -26.10730, lng: 28.05200, businessId: 'mock-biz-7' },
  { ...base, id: 'mock-node-8', name: 'Doubleshot Coffee', slug: 'doubleshot-braamfontein',
    category: 'coffee', lat: -26.18380, lng: 28.01680, businessId: 'mock-biz-2' },
  { ...base, id: 'mock-node-9', name: 'The Grillhouse', slug: 'grillhouse-rosebank',
    category: 'food', lat: -26.14680, lng: 28.04180, businessId: 'mock-biz-1' },
  { ...base, id: 'mock-node-10', name: 'Taboo Nightclub', slug: 'taboo-sandton',
    category: 'nightlife', lat: -26.10850, lng: 28.05720, businessId: 'mock-biz-8' },
  { ...base, id: 'mock-node-11', name: 'Keyes Art Mile', slug: 'keyes-art-mile',
    category: 'arts', lat: -26.14920, lng: 28.04080, businessId: 'mock-biz-6' },
  { ...base, id: 'mock-node-12', name: 'Planet Fitness Melrose', slug: 'planet-fitness-melrose',
    category: 'fitness', lat: -26.13450, lng: 28.06850, businessId: 'mock-biz-5' },
]
