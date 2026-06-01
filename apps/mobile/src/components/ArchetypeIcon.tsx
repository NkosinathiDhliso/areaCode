import { getArchetypeIcon, FALLBACK_ARCHETYPE_ICON } from '@area-code/shared/constants'
import * as PhosphorIcons from 'phosphor-react-native'
import type { Icon } from 'phosphor-react-native'

import { colors } from '../theme'

interface ArchetypeIconProps {
  /** Catalog iconId (e.g. 'festival-spirit'). */
  iconId: string | undefined
  size?: number
  color?: string
}

/**
 * Renders the Phosphor icon for an archetype, driven by the shared
 * `ARCHETYPE_ICONS` data registry so it always matches the web app. Falls back
 * to the eclectic icon for unknown iconIds, and renders nothing if the icon
 * name somehow isn't in the package (defence in depth).
 */
export function ArchetypeIcon({ iconId, size = 24, color = colors.accent }: ArchetypeIconProps) {
  const spec = (iconId ? getArchetypeIcon(iconId) : undefined) ?? FALLBACK_ARCHETYPE_ICON
  const registry = PhosphorIcons as unknown as Record<string, Icon | undefined>
  const Component = registry[spec.name]
  if (!Component) return null
  return <Component size={size} weight={spec.weight} color={color} />
}
