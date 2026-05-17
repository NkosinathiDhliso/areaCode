/**
 * Archetype reveal card (R9.11, R9.12).
 *
 * Renders the user's archetype using the rename module (R9.6) plus the
 * catalog `description` (R9.11). When `getArchetypeEtymology` returns a
 * string, an italicised etymology line is shown beneath the display name
 * (R9.12). For `archetype-uncharted`, the existing helper copy
 * ("Connect a streaming service or pick your genres") is preserved as a
 * call to action (R9.8) so the rename does not erase it.
 *
 * The same component is used in two places:
 *   1. The first-time reveal moment after onboarding / Spotify sync
 *      (rendered inside `StreamingSection` on the consumer profile
 *      screen).
 *   2. Re-reading the archetype on the profile screen at any time
 *      (rendered by the same `StreamingSection` mount), satisfying
 *      R9.11's "the same `description` SHALL also be reachable from the
 *      consumer's profile screen so the user can re-read it."
 */

import { ARCHETYPE_CATALOG } from '@area-code/shared/constants/archetype-catalog'
import { getArchetypeEtymology } from '@area-code/shared/constants'
import { useTranslation } from 'react-i18next'

import { resolveArchetypeDisplayName } from '../lib/archetypeDisplay'

const UNCHARTED_ARCHETYPE_ID = 'archetype-uncharted'

interface ArchetypeRevealProps {
  archetypeId: string
}

export function ArchetypeReveal({ archetypeId }: ArchetypeRevealProps) {
  const { t } = useTranslation()

  // Look up the catalog entry by id so the rename module (R9.6) is the
  // only source of consumer-facing display names. The legacy
  // `archetype.name` field is preserved on the catalog for admin tools
  // (R9.7) and is no longer rendered on consumer surfaces.
  const archetype = ARCHETYPE_CATALOG.find((a) => a.id === archetypeId)
  // `resolveArchetypeDisplayName` falls back to the raw id and emits a
  // non-blocking observability warning for unknown ids (R9.10).
  const displayName = resolveArchetypeDisplayName(archetypeId)
  const etymology = getArchetypeEtymology(archetypeId)
  const isUncharted = archetypeId === UNCHARTED_ARCHETYPE_ID

  // If the id is unknown to the catalog, render just the name fallback
  // so the surface still says something. The warning is already emitted
  // by `resolveArchetypeDisplayName`.
  if (!archetype) {
    return (
      <div className="flex flex-row items-center gap-3 mb-3">
        <div className="flex-1">
          <p className="text-[var(--text-primary)] text-sm font-medium">{displayName}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-row items-start gap-3 mb-3">
        <span className="text-[var(--text-muted)] text-lg">{archetype.iconId}</span>
        <div className="flex-1">
          <p className="text-[var(--text-primary)] text-sm font-medium">{displayName}</p>
          {etymology && <p className="text-[var(--text-muted)] text-xs italic mt-0.5">{etymology}</p>}
          <p className="text-[var(--text-secondary)] text-xs mt-1">{archetype.description}</p>
        </div>
      </div>
      {/*
        R9.8: the rename swaps "The Uncharted" for the short display name
        "Compass". The catalog description already mentions the call to
        action, but the existing dedicated helper copy is kept here as a
        second, more prominent line so the rename does not erase it.
      */}
      {isUncharted && <p className="text-[var(--text-muted)] text-xs mb-3">{t('profile.archetype.uncharted')}</p>}
    </>
  )
}
