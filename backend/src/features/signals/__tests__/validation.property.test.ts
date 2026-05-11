/**
 * Property 2: Signal Value Validation
 *
 * For any signal submission, if the type is `genre_playing` then the value SHALL be
 * accepted if and only if it is one of the 12 defined MusicGenre values; if the type
 * is `queue_length` then the value SHALL be accepted if and only if it is one of
 * `none`, `short`, or `long`. All other values SHALL be rejected.
 *
 * **Validates: Requirements 2.2, 2.3**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  MUSIC_GENRES,
  QUEUE_VALUES,
  musicGenreSchema,
  queueValueSchema,
  submitSignalBodySchema,
} from '../types'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Arbitrary that produces one of the 12 valid MusicGenre values */
const validGenreArb = fc.constantFrom(...MUSIC_GENRES)

/** Arbitrary that produces one of the 3 valid QueueValue values */
const validQueueArb = fc.constantFrom(...QUEUE_VALUES)

/** Arbitrary that produces strings NOT in the valid genre list */
const invalidGenreArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !(MUSIC_GENRES as readonly string[]).includes(s))

/** Arbitrary that produces strings NOT in the valid queue list */
const invalidQueueArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !(QUEUE_VALUES as readonly string[]).includes(s))

/** Arbitrary for a valid nodeId (non-empty string) */
const nodeIdArb = fc.string({ minLength: 1, maxLength: 36 })

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: venue-live-signals, Property 2: Signal Value Validation', () => {
  describe('genre_playing accepts only the 12 MusicGenre values', () => {
    it('accepts all valid MusicGenre values via musicGenreSchema', () => {
      fc.assert(
        fc.property(validGenreArb, (genre) => {
          const result = musicGenreSchema.safeParse(genre)
          expect(result.success).toBe(true)
        }),
        { numRuns: 100 },
      )
    })

    it('rejects all invalid values via musicGenreSchema', () => {
      fc.assert(
        fc.property(invalidGenreArb, (value) => {
          const result = musicGenreSchema.safeParse(value)
          expect(result.success).toBe(false)
        }),
        { numRuns: 100 },
      )
    })

    it('accepts valid genre in full signal submission body', () => {
      fc.assert(
        fc.property(validGenreArb, nodeIdArb, (genre, nodeId) => {
          const result = submitSignalBodySchema.safeParse({
            nodeId,
            type: 'genre_playing',
            value: genre,
          })
          expect(result.success).toBe(true)
        }),
        { numRuns: 100 },
      )
    })

    it('rejects invalid genre in full signal submission body', () => {
      fc.assert(
        fc.property(invalidGenreArb, nodeIdArb, (value, nodeId) => {
          const result = submitSignalBodySchema.safeParse({
            nodeId,
            type: 'genre_playing',
            value,
          })
          expect(result.success).toBe(false)
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('queue_length accepts only none/short/long', () => {
    it('accepts all valid QueueValue values via queueValueSchema', () => {
      fc.assert(
        fc.property(validQueueArb, (queueValue) => {
          const result = queueValueSchema.safeParse(queueValue)
          expect(result.success).toBe(true)
        }),
        { numRuns: 100 },
      )
    })

    it('rejects all invalid values via queueValueSchema', () => {
      fc.assert(
        fc.property(invalidQueueArb, (value) => {
          const result = queueValueSchema.safeParse(value)
          expect(result.success).toBe(false)
        }),
        { numRuns: 100 },
      )
    })

    it('accepts valid queue value in full signal submission body', () => {
      fc.assert(
        fc.property(validQueueArb, nodeIdArb, (queueValue, nodeId) => {
          const result = submitSignalBodySchema.safeParse({
            nodeId,
            type: 'queue_length',
            value: queueValue,
          })
          expect(result.success).toBe(true)
        }),
        { numRuns: 100 },
      )
    })

    it('rejects invalid queue value in full signal submission body', () => {
      fc.assert(
        fc.property(invalidQueueArb, nodeIdArb, (value, nodeId) => {
          const result = submitSignalBodySchema.safeParse({
            nodeId,
            type: 'queue_length',
            value,
          })
          expect(result.success).toBe(false)
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('cross-type validation rejects mismatched values', () => {
    it('rejects queue values used with genre_playing type', () => {
      fc.assert(
        fc.property(validQueueArb, nodeIdArb, (queueValue, nodeId) => {
          // Queue values like "none", "short", "long" are not valid genres
          const result = submitSignalBodySchema.safeParse({
            nodeId,
            type: 'genre_playing',
            value: queueValue,
          })
          expect(result.success).toBe(false)
        }),
        { numRuns: 100 },
      )
    })

    it('rejects genre values used with queue_length type', () => {
      fc.assert(
        fc.property(validGenreArb, nodeIdArb, (genre, nodeId) => {
          // Genre values like "amapiano" are not valid queue values
          const result = submitSignalBodySchema.safeParse({
            nodeId,
            type: 'queue_length',
            value: genre,
          })
          expect(result.success).toBe(false)
        }),
        { numRuns: 100 },
      )
    })
  })
})
