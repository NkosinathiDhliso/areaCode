import type { PrivacyLevel } from '../types'
import { Text } from './primitives'

interface PrivacyIndicatorProps {
  privacyLevel: PrivacyLevel
}

const PRIVACY_CONFIG: Record<PrivacyLevel, { icon: string; label: string; color: string }> = {
  public: { icon: '🔓', label: 'Public', color: 'var(--success)' },
  friends_only: { icon: '👥', label: 'Friends Only', color: 'var(--accent)' },
  private: { icon: '🔒', label: 'Private', color: 'var(--text-muted)' },
}

export function PrivacyIndicator({ privacyLevel }: PrivacyIndicatorProps) {
  const config = PRIVACY_CONFIG[privacyLevel]

  return (
    <Text
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium"
      style={{ color: config.color, backgroundColor: `${config.color}15` }}
    >
      <span>{config.icon}</span>
      {config.label}
    </Text>
  )
}
