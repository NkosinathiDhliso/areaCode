/**
 * Pulse scores for every mock node (Johannesburg, the other SA provinces, and
 * the global sample sites). Covers all 5 NodeState levels:
 *   dormant (0), quiet (1-10), active (11-30), buzzing (31-60), popping (61+)
 */
export const MOCK_PULSE_SCORES: Record<string, number> = {
  'mock-node-1': 45, // buzzing
  'mock-node-2': 8, // quiet
  'mock-node-3': 72, // popping
  'mock-node-4': 25, // active
  'mock-node-5': 3, // quiet
  'mock-node-6': 55, // buzzing
  'mock-node-7': 18, // active
  'mock-node-8': 0, // dormant
  'mock-node-9': 38, // buzzing
  'mock-node-10': 65, // popping
  'mock-node-11': 12, // active
  'mock-node-12': 5, // quiet
  // Pretoria
  'mock-node-13': 30, // active
  'mock-node-14': 58, // buzzing
  'mock-node-15': 22, // active
  // Cape Town
  'mock-node-16': 40, // buzzing
  'mock-node-17': 63, // popping
  'mock-node-18': 35, // buzzing
  'mock-node-19': 28, // active
  // Durban
  'mock-node-20': 33, // buzzing
  'mock-node-21': 10, // quiet
  'mock-node-22': 27, // active
  // Gqeberha
  'mock-node-23': 48, // buzzing
  'mock-node-24': 9, // quiet
  // Bloemfontein
  'mock-node-25': 44, // buzzing
  'mock-node-26': 16, // active
  // Mbombela
  'mock-node-27': 14, // active
  'mock-node-28': 6, // quiet
  // Polokwane
  'mock-node-29': 19, // active
  'mock-node-30': 11, // active
  // Rustenburg
  'mock-node-31': 13, // active
  // Kimberley
  'mock-node-32': 7, // quiet
  // Global
  'mock-node-33': 70, // popping (London)
  'mock-node-34': 61, // popping (New York)
  'mock-node-35': 52, // buzzing (Tokyo)
  'mock-node-36': 47, // buzzing (Sydney)
  'mock-node-37': 50, // buzzing (Rio)
  'mock-node-38': 21, // active (Nairobi)
  'mock-node-39': 42, // buzzing (Dubai)
  'mock-node-40': 39, // buzzing (Paris)
  'mock-node-41': 46, // buzzing (Rome)
}
