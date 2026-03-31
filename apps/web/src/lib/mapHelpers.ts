import type { NodeState, NodeCategory } from '@area-code/shared/types'

const STATE_THRESHOLDS: ReadonlyArray<{ min: number; state: NodeState }> = [
  { min: 61, state: 'popping' },
  { min: 31, state: 'buzzing' },
  { min: 11, state: 'active' },
  { min: 1, state: 'quiet' },
  { min: 0, state: 'dormant' },
]

const MARKER_BASES: Record<NodeState, number> = {
  dormant: 8,
  quiet: 10,
  active: 14,
  buzzing: 20,
  popping: 28,
}

export function getNodeState(score: number): NodeState {
  for (const t of STATE_THRESHOLDS) {
    if (score >= t.min) return t.state
  }
  return 'dormant'
}

export function getMarkerSize(state: NodeState, score: number): number {
  const base = MARKER_BASES[state]
  return Math.min(base + score * 0.4, base * 2.5)
}

/**
 * Returns the hex colour for a node category.
 * Uses resolved hex values since Mapbox marker DOM elements
 * may not reliably inherit CSS custom properties.
 */
const CATEGORY_HEX: Record<string, string> = {
  food: '#ff6b6b',
  coffee: '#a0785a',
  nightlife: '#3B7DD8',
  retail: '#38bdf8',
  fitness: '#22d3a0',
  arts: '#ff9f43',
}

export function getCategoryColour(category: NodeCategory | string): string {
  return CATEGORY_HEX[category] ?? '#778CA9'
}

export function applyMarkerStyle(
  el: HTMLElement,
  size: number,
  colour: string,
): void {
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  el.style.borderRadius = '50%'
  el.style.background = colour
  el.style.cursor = 'pointer'
  el.style.boxShadow = `0 0 ${size}px ${colour}40`
  el.style.transition = 'all 300ms ease'
}
