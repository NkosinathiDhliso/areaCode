import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import type { Node, Reward, NodeState } from '@area-code/shared/types'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import type { GeoStatus } from '@area-code/shared/stores/locationStore'

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
}

export function NodeDetailSheet({
  node, rewards, pulseScore: _pulseScore, state,
  isOpen, onClose, onCheckIn, onSignup,
  qrFallback = false,
}: NodeDetailSheetProps) {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const geoStatus = useLocationStore((s) => s.geoStatus)
  const [menuOpen, setMenuOpen] = useState(false)

  if (!node) return null

  const isDormant = state === 'dormant' && rewards.length === 0
  const activeRewards = rewards.filter((r) => r.isActive)

  function handleCheckIn() {
    if (!isAuthenticated) {
      onSignup()
      return
    }
    onCheckIn()
  }

  function handleShare() {
    const url = `https://areacode.co.za/node/${node!.slug}`
    if (navigator.share) {
      void navigator.share({ title: node!.name, text: t('share.text'), url })
    } else {
      void navigator.clipboard.writeText(url)
    }
    setMenuOpen(false)
  }

  const ctaInfo = getCtaInfo(geoStatus, qrFallback, t)

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      {/* Header */}
      <div className="flex flex-row items-start justify-between mb-4">
        <div className="flex-1">
          <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
            {node.name}
          </h2>
          <p className="text-[var(--text-secondary)] text-sm mt-1">
            {node.category} · {state}
          </p>
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="text-[var(--text-muted)] p-2"
            aria-label="More options"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl py-1 min-w-[160px] z-10">
              <button
                onClick={handleShare}
                className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
              >
                {t('node.share')}
              </button>
              {isAuthenticated && (
                <button
                  onClick={() => setMenuOpen(false)}
                  className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                >
                  {t('node.report')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dormant empty state */}
      {isDormant ? (
        <p className="text-[var(--text-secondary)] text-sm mb-6">
          {t('map.beFirst')}
        </p>
      ) : (
        <>
          {/* Rewards section */}
          {activeRewards.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-2">
                {activeRewards.length} {t('node.activeRewards')}
              </h3>
              <div className="flex flex-col gap-2">
                {activeRewards.map((reward) => {
                  const slotsLeft = reward.totalSlots
                    ? reward.totalSlots - reward.claimedCount
                    : null
                  const isLow = slotsLeft !== null && slotsLeft <= 5

                  return (
                    <div
                      key={reward.id}
                      className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3"
                    >
                      <div className="flex flex-row items-center justify-between">
                        <span className="text-[var(--text-primary)] text-sm font-medium">
                          {reward.title}
                        </span>
                        {slotsLeft !== null && (
                          <span
                            className={`text-xs font-medium ${
                              isLow ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {slotsLeft} {t('node.left')}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* CTA */}
      <button
        onClick={handleCheckIn}
        disabled={ctaInfo.disabled}
        className={`w-full font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 ${
          ctaInfo.disabled
            ? 'bg-[var(--bg-raised)] text-[var(--text-muted)] cursor-not-allowed'
            : 'bg-[var(--accent)] text-white'
        }`}
      >
        {ctaInfo.label}
      </button>
    </BottomSheet>
  )
}

function getCtaInfo(
  geoStatus: GeoStatus,
  qrFallback: boolean,
  t: (key: string) => string,
): { label: string; disabled: boolean } {
  if (qrFallback) {
    return { label: t('checkin.scanQr'), disabled: true }
  }

  switch (geoStatus) {
    case 'requesting':
      return { label: t('checkin.locating'), disabled: true }
    case 'denied':
      return { label: t('checkin.button'), disabled: true }
    case 'poorAccuracy':
      return { label: t('checkin.weakSignal'), disabled: false }
    case 'timeout':
      return { label: t('checkin.locationUnavailable'), disabled: false }
    default:
      return { label: t('checkin.button'), disabled: false }
  }
}
