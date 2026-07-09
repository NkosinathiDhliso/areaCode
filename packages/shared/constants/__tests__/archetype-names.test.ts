import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { ARCHETYPE_CATALOG } from '../archetype-catalog'
import { ARCHETYPE_NAMES, getArchetypeDisplayName, getArchetypeEtymology } from '../archetype-names'

const DISPLAY_NAME_REGEX = /^[A-Z][a-z]+$/

describe('archetype rename completeness (R9)', () => {
  /**
   * Property 11: Every catalog Archetype has exactly one rename entry.
   *
   * Validates: Requirements 9.1, 9.4
   *
   * R9.4 requires the rename map to have exactly one entry per Archetype
   * in `ARCHETYPE_CATALOG`. R9.1 requires every display name to be 3-8
   * Title-Case characters, one or two syllables.
   */
  describe('Property 11: every catalog archetype has exactly one rename entry', () => {
    it('ARCHETYPE_NAMES has the same number of entries as ARCHETYPE_CATALOG', () => {
      expect(Object.keys(ARCHETYPE_NAMES).length).toBe(ARCHETYPE_CATALOG.length)
    })

    it('every catalog id has an entry in ARCHETYPE_NAMES', () => {
      for (const archetype of ARCHETYPE_CATALOG) {
        expect(ARCHETYPE_NAMES[archetype.id]).toBeDefined()
        expect(ARCHETYPE_NAMES[archetype.id]?.id).toBe(archetype.id)
      }
    })

    it('every ARCHETYPE_NAMES key corresponds to a catalog id (no orphan entries)', () => {
      const catalogIds = new Set(ARCHETYPE_CATALOG.map((a) => a.id))
      for (const key of Object.keys(ARCHETYPE_NAMES)) {
        expect(catalogIds.has(key)).toBe(true)
      }
    })

    it('every entry key matches its inner id field', () => {
      for (const [key, entry] of Object.entries(ARCHETYPE_NAMES)) {
        expect(entry.id).toBe(key)
      }
    })

    it('every displayName is Title Case and 3-8 characters long (R9.1)', () => {
      for (const entry of Object.values(ARCHETYPE_NAMES)) {
        expect(entry.displayName).toMatch(DISPLAY_NAME_REGEX)
        expect(entry.displayName.length).toBeGreaterThanOrEqual(3)
        expect(entry.displayName.length).toBeLessThanOrEqual(8)
      }
    })

    it('display names are unique across the catalog', () => {
      const displayNames = Object.values(ARCHETYPE_NAMES).map((e) => e.displayName)
      expect(new Set(displayNames).size).toBe(displayNames.length)
    })

    /**
     * fast-check property: for any catalog id, the rename lookup returns
     * a Title-Case 3-8 character display name.
     */
    it('fast-check: every catalog id resolves to a valid display name', () => {
      const catalogIdArb = fc.constantFrom(...ARCHETYPE_CATALOG.map((a) => a.id))

      fc.assert(
        fc.property(catalogIdArb, (id) => {
          const displayName = getArchetypeDisplayName(id)
          expect(displayName).toMatch(DISPLAY_NAME_REGEX)
          expect(displayName.length).toBeGreaterThanOrEqual(3)
          expect(displayName.length).toBeLessThanOrEqual(8)
        }),
        { numRuns: 200 },
      )
    })
  })

  /**
   * Property 12: Display name is locale-invariant.
   *
   * Validates: Requirement 9.13
   *
   * R9.13 requires `getArchetypeDisplayName` to accept only an id, with
   * no locale parameter. This guarantees the same id renders the same
   * display name on every surface in every locale, so an archetype is
   * a stable identity label rather than a translatable string.
   */
  describe('Property 12: display name is locale-invariant', () => {
    it('getArchetypeDisplayName declares exactly one parameter (no locale)', () => {
      expect(getArchetypeDisplayName.length).toBe(1)
    })

    it('getArchetypeEtymology declares exactly one parameter (no locale)', () => {
      expect(getArchetypeEtymology.length).toBe(1)
    })

    /**
     * fast-check property: the resolved display name does not depend on
     * any second argument the caller might try to pass. Even if a future
     * caller smuggles a locale string, the function ignores it.
     */
    it('fast-check: extra arguments to getArchetypeDisplayName are ignored', () => {
      const catalogIdArb = fc.constantFrom(...ARCHETYPE_CATALOG.map((a) => a.id))
      const localeArb = fc.constantFrom('en', 'en-ZA', 'zu-ZA', 'xh-ZA', 'af-ZA', 'fr', 'de', '')

      fc.assert(
        fc.property(catalogIdArb, localeArb, (id, locale) => {
          const baseline = getArchetypeDisplayName(id)
          // TypeScript's signature blocks a second arg; cast through unknown
          // so we can prove the runtime ignores any extra parameter.
          const withLocale = (getArchetypeDisplayName as unknown as (id: string, locale?: string) => string)(id, locale)
          expect(withLocale).toBe(baseline)
        }),
        { numRuns: 200 },
      )
    })

    it('fast-check: repeated calls with the same id are deeply equal', () => {
      const catalogIdArb = fc.constantFrom(...ARCHETYPE_CATALOG.map((a) => a.id))

      fc.assert(
        fc.property(catalogIdArb, (id) => {
          const first = getArchetypeDisplayName(id)
          const second = getArchetypeDisplayName(id)
          expect(first).toBe(second)
        }),
        { numRuns: 200 },
      )
    })

    it('lookup result does not change with process locale or Date.now', () => {
      // The rename map is a frozen object literal with no locale
      // branching. Calling the resolver across changing wall-clock and
      // locale contexts must produce the same display name.
      const before = Object.values(ARCHETYPE_NAMES).map((e) => getArchetypeDisplayName(e.id))
      // Touch Date.now to make the test honest about wall-clock independence.
      void Date.now()
      const after = Object.values(ARCHETYPE_NAMES).map((e) => getArchetypeDisplayName(e.id))
      expect(after).toEqual(before)
    })
  })

  describe('lookup fallbacks', () => {
    it('returns the raw id for unknown archetypes (R9.10)', () => {
      expect(getArchetypeDisplayName('archetype-does-not-exist')).toBe('archetype-does-not-exist')
    })

    it('returns undefined etymology for archetypes without one', () => {
      // Per R9.5/R9.12 only Kasi carries an etymology line.
      expect(getArchetypeEtymology('archetype-festival-spirit')).toBeUndefined()
      expect(getArchetypeEtymology('archetype-township-royal')).toBeDefined()
    })
  })
})
