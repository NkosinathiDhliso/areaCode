/**
 * Proof that the venue pulse animation is a UNIFORM HEARTBEAT, not a strobe.
 *
 * Two properties are asserted directly against the single source of truth
 * (`PULSE_TEMPO`) and the `heartbeat` keyframe in `packages/shared/tokens.css`:
 *
 *   1. Uniform heartbeat - every Pulse_State drives the *same* `heartbeat`
 *      curve. Aliveness is expressed only by tempo (cycle duration), never by a
 *      different/harsher animation. The curve itself is a scale-only lub-dub
 *      with a rest phase (no opacity flicker).
 *
 *   2. Not a strobe - the fastest state's beat frequency stays far below the
 *      ~3 Hz photosensitivity / flash threshold (WCAG 2.3.1 "three flashes").
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { NodeState } from '@area-code/shared/types'
import { describe, expect, it } from 'vitest'

import { PULSE_TEMPO } from './carouselConstants'

const ALL_STATES: NodeState[] = ['dormant', 'quiet', 'active', 'buzzing', 'popping']

/** Aliveness order (least → most alive) for the tempo-gradient assertion. */
const ALIVENESS_ORDER: NodeState[] = ['dormant', 'quiet', 'active', 'buzzing', 'popping']

/** Parse a CSS time token like "1.6s" / "500ms" into seconds. */
function toSeconds(speed: string): number {
  if (speed.endsWith('ms')) return parseFloat(speed) / 1000
  return parseFloat(speed)
}

/**
 * WCAG 2.3.1 / photosensitivity: content must not flash more than 3 times per
 * second. A heartbeat cycle produces at most one perceptible beat-event
 * (the lub-dub double-thump reads as a single beat, then rests). We bound it
 * conservatively at 2 thumps per cycle and require the rate to sit comfortably
 * below the threshold.
 */
const STROBE_THRESHOLD_HZ = 3
const THUMPS_PER_CYCLE = 2

describe('venue pulse animation - uniform heartbeat, not a strobe', () => {
  it('every Pulse_State uses the SAME heartbeat curve (uniform, not per-state animation)', () => {
    const animations = new Set(ALL_STATES.map((s) => PULSE_TEMPO[s].animation))
    expect(animations).toEqual(new Set(['heartbeat']))
  })

  it('the fastest state never strobes (beat frequency well under 3 Hz)', () => {
    for (const state of ALL_STATES) {
      const cycleSeconds = toSeconds(PULSE_TEMPO[state].speed)
      const flashesPerSecond = THUMPS_PER_CYCLE / cycleSeconds
      expect(flashesPerSecond).toBeLessThan(STROBE_THRESHOLD_HZ)
    }
  })

  it('popping - the busiest, fastest beat - is the worst case and still calm', () => {
    const fastest = Math.min(...ALL_STATES.map((s) => toSeconds(PULSE_TEMPO[s].speed)))
    expect(toSeconds(PULSE_TEMPO.popping.speed)).toBe(fastest)
    // A single beat-event per 1.6s cycle ≈ 0.625 Hz - roughly a resting pulse.
    expect(THUMPS_PER_CYCLE / toSeconds(PULSE_TEMPO.popping.speed)).toBeLessThanOrEqual(1.25)
  })

  it('tempo rises monotonically with aliveness (calm gradient, no jumps)', () => {
    const cycles = ALIVENESS_ORDER.map((s) => toSeconds(PULSE_TEMPO[s].speed))
    for (let i = 1; i < cycles.length; i++) {
      // More alive ⇒ shorter cycle ⇒ faster beat. Strictly decreasing duration.
      expect(cycles[i]).toBeLessThan(cycles[i - 1])
    }
  })

  it('the heartbeat keyframe is scale-only with a rest phase (no opacity flicker)', () => {
    const tokensPath = fileURLToPath(new URL('../../../../packages/shared/tokens.css', import.meta.url))
    const css = readFileSync(tokensPath, 'utf8')
    const match = css.match(/@keyframes\s+heartbeat\s*\{([\s\S]*?)\n\}/)
    expect(match, 'heartbeat keyframe must exist in tokens.css').toBeTruthy()
    const body = match![1]

    // Not a strobe: no opacity flashing inside the heartbeat curve.
    expect(body).not.toMatch(/opacity/)
    // It is a beat: it scales.
    expect(body).toMatch(/transform:\s*scale/)
    // It rests: the tail holds steady at scale(1) (the "calm between beats").
    expect(body).toMatch(/70%[\s\S]*scale\(1\)/)
  })
})
