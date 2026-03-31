/**
 * Pulse scores for all 12 mock nodes.
 * Covers all 5 NodeState levels:
 *   dormant (0), quiet (1-10), active (11-30), buzzing (31-60), popping (61+)
 */
export const MOCK_PULSE_SCORES: Record<string, number> = {
  'mock-node-1': 45,   // buzzing
  'mock-node-2': 8,    // quiet
  'mock-node-3': 72,   // popping
  'mock-node-4': 25,   // active
  'mock-node-5': 3,    // quiet
  'mock-node-6': 55,   // buzzing
  'mock-node-7': 18,   // active
  'mock-node-8': 0,    // dormant
  'mock-node-9': 38,   // buzzing
  'mock-node-10': 65,  // popping
  'mock-node-11': 12,  // active
  'mock-node-12': 5,   // quiet
}
