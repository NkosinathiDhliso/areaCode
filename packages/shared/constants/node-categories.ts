import type { NodeCategory } from '../types'

export const NODE_CATEGORIES: readonly { value: NodeCategory; label: string; colour: string }[] = [
  { value: 'food', label: 'Food', colour: 'var(--node-food)' },
  { value: 'coffee', label: 'Coffee', colour: 'var(--node-coffee)' },
  { value: 'nightlife', label: 'Nightlife', colour: 'var(--node-nightlife)' },
  { value: 'retail', label: 'Retail', colour: 'var(--node-retail)' },
  { value: 'fitness', label: 'Fitness', colour: 'var(--node-fitness)' },
  { value: 'arts', label: 'Arts', colour: 'var(--node-arts)' },
] as const
