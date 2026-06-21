import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import type { Node, Reward, NodeState } from '@area-code/shared/types'
import { memo } from 'react'

import { NodeDetailContent } from './NodeDetailContent'

interface NodeDetailSheetProps {
  node: Node | null
  rewards: Reward[]
  pulseScore: number
  state: NodeState
  isOpen: boolean
  onClose: () => void
  onCheckIn: () => void
  onSignup: () => void
  qrFallback?: boolean
  isCheckingIn?: boolean
  /**
   * When the sheet was opened via the cross-screen focus signal (e.g. from
   * the Gets list), use a lighter backdrop so neighbouring pulsing venues
   * stay visible behind the sheet. Encourages multi-venue evening planning.
   */
  transparentBackdrop?: boolean
  /**
   * Optional node-flick handlers. When provided, a prev/next control row is
   * shown at the top of the sheet so the user can cycle through nearby venues
   * without closing the sheet. Each step flies the map and fires a live
   * check-in-count toast (see MapScreen `handleFlick`).
   */
  onPrev?: () => void
  onNext?: () => void
}

/**
 * `NodeDetailSheet` - the standalone venue detail surface: the full
 * {@link NodeDetailContent} body hosted in its own {@link BottomSheet}.
 *
 * The detail body was extracted into {@link NodeDetailContent} so the same
 * content can also be rendered by the Peek_Carousel as its Commit_Mode body on
 * a single shared sheet (Requirement 2.5). This component preserves the
 * original standalone behaviour (including the lighter focus backdrop and the
 * legacy prev/next flick row) for callers that still mount a detail sheet
 * directly.
 */
export const NodeDetailSheet = memo(function NodeDetailSheet({
  node,
  rewards,
  pulseScore,
  state,
  isOpen,
  onClose,
  onCheckIn,
  onSignup,
  qrFallback = false,
  isCheckingIn = false,
  transparentBackdrop = false,
  onPrev,
  onNext,
}: NodeDetailSheetProps) {
  if (!node) return null

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} transparentBackdrop={transparentBackdrop}>
      <NodeDetailContent
        node={node}
        rewards={rewards}
        pulseScore={pulseScore}
        state={state}
        onCheckIn={onCheckIn}
        onSignup={onSignup}
        qrFallback={qrFallback}
        isCheckingIn={isCheckingIn}
        onPrev={onPrev}
        onNext={onNext}
      />
    </BottomSheet>
  )
})
