/**
 * Unit tests for `ArchetypeReveal` (R9.8, R9.11, R9.12).
 *
 * The reveal component is the only consumer-facing surface that has to
 * render all three of: short display name, catalog description, and the
 * etymology line for non-English names. These tests pin that contract.
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ArchetypeReveal } from '../ArchetypeReveal'

// `useTranslation` is the only external concern. The shared i18n bundle
// is wired up at app boot; in unit tests i18next falls back to the key
// when no resources are loaded, which is good enough to assert the key
// is rendered for `archetype-uncharted`.
describe('ArchetypeReveal', () => {
  it('renders the short display name from the rename module (R9.6, R9.11)', () => {
    render(<ArchetypeReveal archetypeId="archetype-festival-spirit" />)
    // Display name is "Blaze" per the R9.5 table. `getByText` throws if
    // not found, so no jest-dom matcher is required.
    expect(screen.getByText('Blaze')).toBeTruthy()
  })

  it('renders the catalog description alongside the display name (R9.11)', () => {
    render(<ArchetypeReveal archetypeId="archetype-festival-spirit" />)
    // The catalog description for festival-spirit starts with "Lives for".
    expect(screen.getByText(/^Lives for the energy/)).toBeTruthy()
  })

  it('renders an italicised etymology line for archetype-township-royal (R9.12)', () => {
    render(<ArchetypeReveal archetypeId="archetype-township-royal" />)
    expect(screen.getByText('Kasi')).toBeTruthy()
    const etymology = screen.getByText(/isiZulu and isiXhosa for township/i)
    expect(etymology).toBeTruthy()
    // The etymology line is italicised so non-English provenance reads
    // visually distinct from the description body.
    expect(etymology.className).toMatch(/italic/)
  })

  it('omits the etymology line for archetypes whose names are English', () => {
    render(<ArchetypeReveal archetypeId="archetype-festival-spirit" />)
    // No etymology row exists for Blaze (English name).
    expect(screen.queryByText(/isiZulu|township pride/i)).toBeNull()
  })

  it('preserves the "Connect a streaming service" call to action for archetype-uncharted (R9.8)', () => {
    render(<ArchetypeReveal archetypeId="archetype-uncharted" />)
    // The display name swaps to "Compass" but the helper copy survives
    // via the `profile.archetype.uncharted` i18n key.
    expect(screen.getByText('Compass')).toBeTruthy()
    expect(screen.getByText('profile.archetype.uncharted')).toBeTruthy()
  })

  it('falls back to the raw id when archetypeId is unknown (R9.10)', () => {
    render(<ArchetypeReveal archetypeId="archetype-not-real" />)
    expect(screen.getByText('archetype-not-real')).toBeTruthy()
    // Unknown ids have no description or etymology — nothing else to
    // assert beyond the name fallback.
  })
})
