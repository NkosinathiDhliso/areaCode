import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { aggregateCounts, recordEvents } from '../service.js'
import { eventBatchBodySchema, usageEventSchema, MAX_EVENTS_PER_BATCH, type UsageEventInput } from '../types.js'

/** A minimal valid event for the schema (name on allowlist, positive ts). */
function evt(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, sessionId: 'sess-abc', ts: 1_700_000_000_000, ...extra }
}

describe('events types — allowlist rejection (R4.5)', () => {
  it('accepts a batch of allowlisted event names', () => {
    const result = eventBatchBodySchema.safeParse({
      events: [evt('beam_tap'), evt('zoom_commit'), evt('checkin_completed')],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a batch containing an off-allowlist event name', () => {
    const result = eventBatchBodySchema.safeParse({
      events: [evt('beam_tap'), evt('totally_made_up_event')],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a single event with an unknown name', () => {
    expect(usageEventSchema.safeParse(evt('definitely_not_allowed')).success).toBe(false)
  })
})

describe('events types — batch limits and strictness', () => {
  it('rejects a batch with more than 20 events', () => {
    const events = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => evt('beam_tap'))
    expect(eventBatchBodySchema.safeParse({ events }).success).toBe(false)
  })

  it('accepts a batch at the 20-event cap', () => {
    const events = Array.from({ length: MAX_EVENTS_PER_BATCH }, () => evt('beam_tap'))
    expect(eventBatchBodySchema.safeParse({ events }).success).toBe(true)
  })

  it('rejects an empty events array', () => {
    expect(eventBatchBodySchema.safeParse({ events: [] }).success).toBe(false)
  })

  it('rejects an unknown top-level property on an event (.strict())', () => {
    const result = eventBatchBodySchema.safeParse({
      events: [evt('beam_tap', { userId: 'user-123' })],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a coordinate smuggled onto an event (.strict())', () => {
    const result = eventBatchBodySchema.safeParse({
      events: [evt('beam_tap', { lat: -26.2, lng: 28.0 })],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown top-level body property (.strict())', () => {
    const result = eventBatchBodySchema.safeParse({
      events: [evt('beam_tap')],
      extra: 'nope',
    })
    expect(result.success).toBe(false)
  })

  it('accepts only the closed props set (city/method) and rejects free-text props', () => {
    expect(
      usageEventSchema.safeParse(evt('signup_completed', { props: { city: 'johannesburg', method: 'google' } }))
        .success,
    ).toBe(true)
    expect(usageEventSchema.safeParse(evt('signup_completed', { props: { note: 'free text' } })).success).toBe(false)
  })
})

describe('events service — aggregateCounts', () => {
  it('counts duplicate names within a batch', () => {
    const events: UsageEventInput[] = [
      evt('beam_tap'),
      evt('beam_tap'),
      evt('beam_tap'),
      evt('zoom_commit'),
    ] as UsageEventInput[]

    const counts = aggregateCounts(events)
    expect(counts.get('beam_tap')).toBe(3)
    expect(counts.get('zoom_commit')).toBe(1)
    expect(counts.size).toBe(2)
  })

  it('returns an empty map for an empty batch', () => {
    expect(aggregateCounts([]).size).toBe(0)
  })
})

describe('events service — EMF line shape (R4.4) and no PII (R4.3)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('emits one EMF line per distinct event name with the correct shape', () => {
    const events: UsageEventInput[] = [
      evt('beam_tap', { props: { city: 'durban' } }),
      evt('beam_tap'),
      evt('zoom_commit'),
    ] as UsageEventInput[]

    recordEvents(events)

    // One line per distinct name (beam_tap, zoom_commit).
    expect(logSpy).toHaveBeenCalledTimes(2)

    const lines = logSpy.mock.calls.map((c) => JSON.parse(c[0] as string))
    const byEvent = new Map(lines.map((l) => [l.event, l]))

    const beamLine = byEvent.get('beam_tap')
    expect(beamLine).toBeDefined()
    expect(beamLine.Count).toBe(2)
    expect(byEvent.get('zoom_commit').Count).toBe(1)

    // EMF _aws block shape.
    const cw = beamLine._aws.CloudWatchMetrics[0]
    expect(cw.Namespace).toBe('AreaCode/Usage')
    expect(cw.Dimensions).toEqual([['event']])
    expect(cw.Metrics).toEqual([{ Name: 'Count', Unit: 'Count' }])
    expect(typeof beamLine._aws.Timestamp).toBe('number')
  })

  it('never emits sessionId or props in the EMF line (POPIA, R4.3)', () => {
    const events: UsageEventInput[] = [
      evt('signup_completed', { sessionId: 'secret-session', props: { city: 'cape-town', method: 'email' } }),
    ] as UsageEventInput[]

    recordEvents(events)

    expect(logSpy).toHaveBeenCalledTimes(1)
    const raw = logSpy.mock.calls[0]![0] as string
    const line = JSON.parse(raw)

    // Only event + Count + _aws are present. No identity or coarse props leak.
    expect(new Set(Object.keys(line))).toEqual(new Set(['_aws', 'event', 'Count']))
    expect(raw).not.toContain('secret-session')
    expect(raw).not.toContain('sessionId')
    expect(raw).not.toContain('props')
    expect(raw).not.toContain('cape-town')
  })
})
