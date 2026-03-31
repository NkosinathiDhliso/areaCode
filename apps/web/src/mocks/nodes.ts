import type { Node } from '@area-code/shared/types'

/**
 * Mock nodes at accurate Johannesburg venue coordinates.
 * Pulse scores simulate different node states:
 * dormant (0), quiet (1-10), active (11-30), buzzing (31-60), popping (61+)
 */

export const MOCK_PULSE_SCORES: Record<string, number> = {
  'mock-1': 45,   // buzzing
  'mock-2': 8,    // quiet
  'mock-3': 72,   // popping
  'mock-4': 25,   // active
  'mock-5': 3,    // quiet
  'mock-6': 55,   // buzzing
  'mock-7': 18,   // active
  'mock-8': 0,    // dormant
  'mock-9': 38,   // buzzing
  'mock-10': 65,  // popping
  'mock-11': 12,  // active
  'mock-12': 5,   // quiet
}

const base = {
  cityId: 'jhb', businessId: null, submittedBy: null,
  claimStatus: 'unclaimed' as const, claimCipcStatus: null,
  nodeColour: 'default', nodeIcon: null,
  qrCheckinEnabled: false, isVerified: true, isActive: true,
  createdAt: '2026-03-01T00:00:00Z',
}

export const MOCK_NODES: Node[] = [
  // Rosebank Mall area
  { ...base, id: 'mock-1', name: "Nando's Rosebank", slug: 'nandos-rosebank',
    category: 'food', lat: -26.14565, lng: 28.04325 },
  // Father Coffee — 44 Stanley, Milpark
  { ...base, id: 'mock-2', name: 'Father Coffee', slug: 'father-coffee',
    category: 'coffee', lat: -26.18340, lng: 28.01720 },
  // Kitchener's Cove Bar — 2 Juta St, Braamfontein
  { ...base, id: 'mock-3', name: "Kitchener's Bar", slug: 'kitcheners-bar',
    category: 'nightlife', lat: -26.19310, lng: 28.03480 },
  // Neighbourgoods Market — 73 Juta St, Braamfontein
  { ...base, id: 'mock-4', name: 'Neighbourgoods Market', slug: 'neighbourgoods-market',
    category: 'food', lat: -26.19250, lng: 28.03350 },
  // Virgin Active Sandton — Sandton Drive
  { ...base, id: 'mock-5', name: 'Virgin Active Sandton', slug: 'virgin-active-sandton',
    category: 'fitness', lat: -26.10680, lng: 28.05280 },
  // Arts on Main — Maboneng, 264 Fox St
  { ...base, id: 'mock-6', name: 'Arts on Main', slug: 'arts-on-main',
    category: 'arts', lat: -26.20480, lng: 28.05650 },
  // Sandton City Mall — Rivonia Rd & 5th St
  { ...base, id: 'mock-7', name: 'Sandton City', slug: 'sandton-city',
    category: 'retail', lat: -26.10730, lng: 28.05200 },
  // Doubleshot Coffee — 44 Stanley, Milpark
  { ...base, id: 'mock-8', name: 'Doubleshot Coffee', slug: 'doubleshot-braamfontein',
    category: 'coffee', lat: -26.18380, lng: 28.01680 },
  // The Grillhouse — The Firs, cnr Cradock & Biermann, Rosebank
  { ...base, id: 'mock-9', name: 'The Grillhouse', slug: 'grillhouse-rosebank',
    category: 'food', lat: -26.14680, lng: 28.04180 },
  // Taboo — Maude St, Sandton
  { ...base, id: 'mock-10', name: 'Taboo Nightclub', slug: 'taboo-sandton',
    category: 'nightlife', lat: -26.10850, lng: 28.05720 },
  // Keyes Art Mile — Keyes Ave, Rosebank
  { ...base, id: 'mock-11', name: 'Keyes Art Mile', slug: 'keyes-art-mile',
    category: 'arts', lat: -26.14920, lng: 28.04080 },
  // Planet Fitness Melrose Arch
  { ...base, id: 'mock-12', name: 'Planet Fitness Melrose', slug: 'planet-fitness-melrose',
    category: 'fitness', lat: -26.13450, lng: 28.06850 },
]
