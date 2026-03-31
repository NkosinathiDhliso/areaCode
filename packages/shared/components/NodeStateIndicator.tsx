import type { NodeState } from '../types'
import { Box, Row, Text } from './primitives'

interface NodeStateIndicatorProps {
  state: NodeState
}

const STATE_CONFIG: Record<NodeState, { label: string; className: string }> = {
  dormant: { label: 'Dormant', className: 'text-[var(--text-muted)]' },
  quiet: { label: 'Quiet', className: 'text-[var(--text-secondary)]' },
  active: { label: 'Active', className: 'text-[var(--success)]' },
  buzzing: { label: 'Buzzing', className: 'text-[var(--warning)]' },
  popping: { label: 'Popping', className: 'text-[var(--danger)]' },
}

const DOT_STYLES: Record<NodeState, string> = {
  dormant: 'bg-[var(--text-muted)]',
  quiet: 'bg-[var(--text-secondary)]',
  active: 'bg-[var(--success)]',
  buzzing: 'bg-[var(--warning)]',
  popping: 'bg-[var(--danger)]',
}

export function NodeStateIndicator({ state }: NodeStateIndicatorProps) {
  const config = STATE_CONFIG[state]
  const dotClass = DOT_STYLES[state]

  return (
    <Row className="items-center gap-1.5">
      <Box className={`w-2 h-2 rounded-full ${dotClass}`} />
      <Text className={`text-xs font-medium ${config.className}`}>
        {config.label}
      </Text>
    </Row>
  )
}
