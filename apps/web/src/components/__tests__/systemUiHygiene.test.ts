/**
 * Proof of Demand R15.25 regression guards.
 *
 *   - No emoji in system UI (`code-style.md`): the pin that used to sit in the
 *     `LeaderboardScreen` venue-streak line and the `main.tsx` boot fallback.
 *   - The success-banner timers in `NodeDetailContent` and `StreamingSection`
 *     go through `useSafeTimeout`, so nothing fires against an unmounted
 *     component. A bare `setTimeout` in either file is the defect returning.
 *
 * Validates: Requirements 15.25
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const webSrc = resolve(here, '../..')

function readSource(relativePath: string): string {
  return readFileSync(resolve(webSrc, relativePath), 'utf8')
}

const EMOJI = /\p{Extended_Pictographic}/u

describe('R15.25 no emoji in system UI', () => {
  it.each(['screens/LeaderboardScreen.tsx', 'main.tsx'])('renders no emoji in %s', (file) => {
    expect(EMOJI.test(readSource(file))).toBe(false)
  })
})

describe('R15.25 timers cleared on unmount', () => {
  it.each(['components/NodeDetailContent.tsx', 'components/StreamingSection.tsx'])(
    'schedules through useSafeTimeout in %s',
    (file) => {
      const source = readSource(file)
      expect(source).toContain('useSafeTimeout')
      // `setSafeTimeout(` is the wrapper; a bare `setTimeout(` is not cleared.
      expect(/(?<!safe)(?<!Safe)\bsetTimeout\(/.test(source)).toBe(false)
    },
  )
})
