import type { Node } from '@area-code/shared/types'

/**
 * Mock nodes scattered around Johannesburg CBD / Braamfontein / Maboneng
 * for local development without a backend.
 *
 * Mock pulse scores simulate different node states:
 * dormant (0), quiet (1-10), active (11-30), buzzing (31-60), popping (61+)
 */

export const MOCK_PULSE_SCORES: Record<string, number> = {
  'mock-1': 45,   // buzzing — Nando's
  'mock-2': 8,    // quiet — Father Coffee
  'mock-3': 72,   // popping — Kitchener's
  'mock-4': 25,   // active — Neighbourgoods
  'mock-5': 3,    // quiet — Virgin Active
  'mock-6': 55,   // buzzing — Maboneng
  'mock-7': 18,   // active — Sandton City
  'mock-8': 0,    // dormant — Doubleshot
  'mock-9': 38,   // buzzing — Grillhouse
  'mock-10': 65,  // popping — Taboo
  'mock-11': 12,  // active — Keyes Art Mile
  'mock-12': 5,   // quiet — Planet Fitness
}

export const MOCK_NODES: Node[] = [
  {
    id: 'mock-1', name: 'Nando\'s Rosebank', slug: 'nandos-rosebank',
    category: 'food', lat: -26.1467, lng: 28.0436,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'mock-2', name: 'Father Coffee', slug: 'father-coffee',
    category: 'coffee', lat: -26.2023, lng: 28.0436,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'mock-3', name: 'Kitchener\'s Bar', slug: 'kitcheners-bar',
    category: 'nightlife', lat: -26.2041, lng: 28.0473,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'mock-4', name: 'Neighbourgoods Market', slug: 'neighbourgoods-market',
    category: 'food', lat: -26.1960, lng: 28.0340,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'mock-5', name: 'Virgin Active Sandton', slug: 'virgin-active-sandton',
    category: 'fitness', lat: -26.1076, lng: 28.0567,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'mock-6', name: 'Maboneng Precinct', slug: 'maboneng-precinct',
    category: 'arts', lat: -26.2025, lng: 28.0575,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'mock-7', name: 'Sandton City', slug: 'sandton-city',
    category: 'retail', lat: -26.1076, lng: 28.0520,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'mock-8', name: 'Doubleshot Coffee', slug: 'doubleshot-braamfontein',
    category: 'coffee', lat: -26.1930, lng: 28.0370,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'mock-9', name: 'The Grillhouse', slug: 'grillhouse-rosebank',
    category: 'food', lat: -26.1450, lng: 28.0410,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'mock-10', name: 'Taboo Nightclub', slug: 'taboo-sandton',
    category: 'nightlife', lat: -26.1100, lng: 28.0560,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'mock-11', name: 'Keyes Art Mile', slug: 'keyes-art-mile',
    category: 'arts', lat: -26.1480, lng: 28.0450,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'mock-12', name: 'Planet Fitness Melrose', slug: 'planet-fitness-melrose',
    category: 'fitness', lat: -26.1380, lng: 28.0620,
    cityId: 'jhb', businessId: null, submittedBy: null,
    claimStatus: 'unclaimed', claimCipcStatus: null,
    nodeColour: 'default', nodeIcon: null,
    qrCheckinEnabled: false, isVerified: true, isActive: true, createdAt: '2026-03-01T00:00:00Z',
  },
]
