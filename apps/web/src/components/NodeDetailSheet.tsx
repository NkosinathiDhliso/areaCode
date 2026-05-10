import { useState, memo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import { Badge } from '@area-code/shared/components/Badge'
import { api } from '@area-code/shared/lib/api'
import type { Node, Reward, NodeState } from '@area-code/shared/types'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import type { GeoStatus } from '@area-code/shared/stores/locationStore'
import { useCooldownTimer } from '@area-code/shared/hooks/useCooldownTimer'
import { CrowdVibeSection } from './CrowdVibeSection'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { analytics } from '@area-code/shared/analytics/client'
import { haversineDistance } from '@area-code/shared/lib/geoUtils'

interface NodeDetailSheetProps {
  node: Node | null
  rewards: Reward[]
  pulseScore: number
  state: NodeState
  isOpen: boolean
  onClose: () => void
  onCheckIn: () => void
  onSignup: () => void
  onRecalibrate?: () => void
  qrFallback?: boolean
  tooFar?: boolean
  cooldownUntil?: string | null
}

export const NodeDetailSheet = memo(function NodeDetailSheet({
  node,
  rewards,
  state,
  isOpen,
  onClose,
  onCheckIn,
  onSignup,
  onRecalibrate,
  qrFallback = false,
  tooFar = false,
  cooldownUntil = null,
  pulseScore,
}: NodeDetailSheetProps) {
  const { isActive: inCooldown, display: cooldownDisplay } = useCooldownTimer(cooldownUntil)
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const isBusinessAuthenticated = useBusinessAuthStore((s) => s.isAuthenticated)
  const geoStatus = useLocationStore((s) => s.geoStatus)
  const lastKnownPosition = useLocationStore((s) => s.lastKnownPosition)
  const userLat = lastKnownPosition?.lat ?? null
  const userLng = lastKnownPosition?.lng ?? null
  const [menuOpen, setMenuOpen] = useState(false)
  const [claimModalOpen, setClaimModalOpen] = useState(false)
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState('')
  const [claimSuccess, setClaimSuccess] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const [reportType, setReportType] = useState<
    'wrong_location' | 'permanently_closed' | 'fake_rewards' | 'offensive_content' | 'other'
  >('other')
  const [reportDetail, setReportDetail] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportSuccess, setReportSuccess] = useState(false)
  const [rewardsLoading, setRewardsLoading] = useState(true)

  const isDormant = state === 'dormant' && rewards.length === 0
  const activeRewards = rewards.filter((r) => r.isActive)
  const isBoosted = node?.boostUntil ? new Date(node.boostUntil).getTime() > Date.now() : false

  // Compute distance
  const distanceText = node && userLat && userLng
    ? formatDistance(haversineDistance(userLat, userLng, node.lat, node.lng))
    : null

  useEffect(() => {
    if (rewards.length > 0 || !isOpen) {
      setRewardsLoading(false)
    } else {
      setRewardsLoading(true)
      const timer = setTimeout(() => setRewardsLoading(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [isOpen, rewards.length])

  useEffect(() => {
    if (!node || !isOpen || activeRewards.length === 0) return
    activeRewards.forEach((reward) => {
      analytics.track('reward_viewed', { rewardId: reward.id, nodeId: node.id })
    })
  }, [isOpen, node?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!node) return null

  function handleCheckIn() {
    if (!isAuthenticated) { onSignup(); return }
    onCheckIn()
  }

  function handleDirections() {
    if (!node) return
    openDirections(node.lat, node.lng, node.name)
    setMenuOpen(false)
  }

  function handleInstagram() {
    const handle = (node as Node & { instagramHandle?: string }).instagramHandle
    if (handle) {
      window.open(`https://instagram.com/${handle}`, '_blank')
    }
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

  async function handleSubmitReport() {
    if (!node) return
    setReporting(true)
    setReportError('')
    try {
      await api.post(`/v1/nodes/${node.id}/report`, { type: reportType, detail: reportDetail.trim() || undefined })
      setReportSuccess(true)
      setTimeout(() => { setReportModalOpen(false); setReportSuccess(false); setReportDetail(''); setReportType('other') }, 1500)
    } catch (err: unknown) {
      setReportError((err as { message?: string })?.message ?? t('node.reportError', 'Failed to submit report.'))
    } finally { setReporting(false) }
  }

  async function handleClaim() {
    if (!node) return
    setClaiming(true)
    setClaimError('')
    try {
      await api.post(`/v1/nodes/${node.id}/claim`, { registrationNumber: registrationNumber.trim() })
      setClaimSuccess(true)
      setTimeout(() => { setClaimModalOpen(false); setClaimSuccess(false); setRegistrationNumber('') }, 2000)
    } catch (err: unknown) {
      setClaimError((err as { message?: string })?.message || t('node.claimError'))
    } finally { setClaiming(false) }
  }

  const ctaInfo = getCtaInfo(geoStatus, qrFallback, tooFar, inCooldown, t)
  const headerImageKey = (node as Node & { headerImageKey?: string | null }).headerImageKey
  const instagramHandle = (node as Node & { instagramHandle?: string | null }).instagramHandle

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={node.name} snapPoints={['half', 'full']}>
      {/* Header Image or Gradient Placeholder */}
      <div className="relative -mx-5 -mt-5 mb-4 rounded-t-3xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
        {headerImageKey ? (
          <img
            src={`${import.meta.env['VITE_CDN_URL'] ?? ''}/nodes/${headerImageKey}`}
            alt={node.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full"
            style={{ background: `var(--node-${node.category}-glow, var(--gradient-surface))` }}
          />
        )}
        {isBoosted && (
          <div className="absolute top-3 right-3 bg-[var(--color-boost-gold)]/90 text-black text-xs font-bold px-2 py-1 rounded-full">
            ⚡ Boosted
          </div>
        )}
      </div>

      {/* Venue Name + Category + Pulse + Distance */}
      <div className="flex flex-row items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[var(--text-primary)] font-bold font-[Syne]" style={{ fontSize: 'var(--font-2xl)', lineHeight: 'var(--font-2xl-lh)' }}>
              {node.name}
            </h2>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[var(--text-secondary)] text-sm capitalize">{node.category}</span>
            <Badge variant="pulse-state" label={state} />
            {distanceText && (
              <span className="text-[var(--text-muted)] text-xs">{distanceText}</span>
            )}
          </div>
        </div>
        <div className="relative">
          <button onClick={() => setMenuOpen(!menuOpen)} className="text-[var(--text-muted)] p-2" aria-label="More options">⋯</button>
          {menuOpen && (
            <div className="absolute right-0 top-8 bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl py-1 min-w-[160px] z-10">
              <button onClick={handleShare} className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)]">{t('node.share')}</button>
              {isAuthenticated && (
                <button onClick={() => { setMenuOpen(false); setReportModalOpen(true) }} className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)]">{t('node.report')}</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto mb-4">
        {/* Cooldown banner */}
        {inCooldown && !tooFar && (
          <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 mb-3 flex items-center justify-between gap-3">
            <div className="flex-1">
              <p className="text-[var(--text-primary)] text-sm font-medium">{t('checkin.alreadyCheckedIn')}</p>
              <p className="text-[var(--text-secondary)] text-xs mt-0.5">{t('checkin.nextRewardIn')} {cooldownDisplay}</p>
            </div>
            <span className="text-[var(--success)] text-xl" aria-label="checked in">✓</span>
          </div>
        )}

        {/* Too far banner */}
        {tooFar && (
          <div className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 mb-3 flex items-center justify-between gap-3">
            <div className="flex-1">
              <p className="text-[var(--text-primary)] text-sm font-medium">{t('checkin.tooFar', "You're too far from this venue")}</p>
              <p className="text-[var(--text-secondary)] text-xs mt-0.5">{t('checkin.tooFarHint', 'Move closer or recalibrate your location.')}</p>
            </div>
            {onRecalibrate && (
              <button onClick={onRecalibrate} className="flex-shrink-0 bg-[var(--accent)] text-white text-xs font-semibold rounded-lg px-3 py-2 active:scale-95 transition-all">{t('checkin.recalibrate', 'Recalibrate')}</button>
            )}
          </div>
        )}

        {/* Dormant empty state */}
        {isDormant ? (
          <p className="text-[var(--text-secondary)] text-sm mb-4">{t('map.beFirst')}</p>
        ) : (
          <>
            {/* Rewards section with skeleton loading */}
            {rewardsLoading ? (
              <div className="mb-4">
                <div className="h-4 w-24 bg-[var(--bg-raised)] rounded animate-shimmer mb-3" />
                {[1, 2].map((i) => (
                  <div key={i} className="bg-[var(--bg-raised)] rounded-2xl px-4 py-4 mb-2 animate-shimmer">
                    <div className="h-4 w-3/4 bg-[var(--border)] rounded" />
                  </div>
                ))}
              </div>
            ) : activeRewards.length > 0 ? (
              <div className="mb-4">
                <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-2">
                  {activeRewards.length} {t('node.activeRewards')}
                </h3>
                <div className="flex flex-col gap-2">
                  {activeRewards.map((reward) => {
                    const slotsLeft = reward.totalSlots ? reward.totalSlots - reward.claimedCount : null
                    const isLow = slotsLeft !== null && slotsLeft <= 5
                    return (
                      <div key={reward.id} className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3">
                        <div className="flex flex-row items-center justify-between">
                          <span className="text-[var(--text-primary)] text-sm font-medium">{reward.title}</span>
                          {slotsLeft !== null && (
                            <span className={`text-xs font-medium ${isLow ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
                              {slotsLeft} {t('node.left')}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <CrowdVibeSection nodeId={node.id} />
          </>
        )}
      </div>

      {/* Sticky Bottom CTA */}
      <div className="sticky bottom-0 bg-[var(--bg-raised)] pt-3 -mx-5 px-5 pb-[env(safe-area-inset-bottom,0px)] border-t border-[var(--border)]">
        {/* Primary: Check In */}
        <button
          onClick={handleCheckIn}
          disabled={ctaInfo.disabled}
          className={`w-full font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 mb-2 ${
            ctaInfo.disabled
              ? 'bg-[var(--bg-surface)] text-[var(--text-muted)] cursor-not-allowed'
              : 'gradient-cta text-white'
          }`}
        >
          {ctaInfo.label}
        </button>

        {/* Secondary row: Instagram + Directions */}
        <div className="flex gap-2">
          {instagramHandle && (
            <button
              onClick={handleInstagram}
              className="flex-1 flex items-center justify-center gap-2 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] font-medium rounded-xl py-3 text-sm transition-all duration-150 active:scale-95"
              aria-label="View on Instagram"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              Instagram
            </button>
          )}
          <button
            onClick={handleDirections}
            className={`${instagramHandle ? 'flex-1' : 'w-full'} flex items-center justify-center gap-2 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] font-medium rounded-xl py-3 text-sm transition-all duration-150 active:scale-95`}
            aria-label="Get directions"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
            {t('node.directions', 'Directions')}
          </button>
        </div>

        {/* Claim venue for business users */}
        {isBusinessAuthenticated && node.claimStatus === 'unclaimed' && (
          <button onClick={() => setClaimModalOpen(true)} className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] text-white font-medium rounded-xl py-3 text-sm mt-2 transition-all duration-150 active:scale-95">
            {t('node.claimVenue')}
          </button>
        )}
      </div>

      {/* Report Modal */}
      {reportModalOpen && <ReportModal node={node} reportType={reportType} setReportType={setReportType} reportDetail={reportDetail} setReportDetail={setReportDetail} reporting={reporting} reportError={reportError} reportSuccess={reportSuccess} onSubmit={() => void handleSubmitReport()} onClose={() => { setReportModalOpen(false); setReportError('') }} t={(key: string, fallback?: string) => t(key, fallback ?? key)} />}

      {/* Claim Modal */}
      {claimModalOpen && <ClaimModal claiming={claiming} claimError={claimError} claimSuccess={claimSuccess} registrationNumber={registrationNumber} setRegistrationNumber={setRegistrationNumber} onSubmit={() => void handleClaim()} onClose={() => setClaimModalOpen(false)} t={(key: string, fallback?: string) => t(key, fallback ?? key)} />}
    </BottomSheet>
  )
})


// ─── Helper Components ──────────────────────────────────────────────────────

function ReportModal({ node, reportType, setReportType, reportDetail, setReportDetail, reporting, reportError, reportSuccess, onSubmit, onClose, t }: {
  node: Node; reportType: string; setReportType: (v: 'wrong_location' | 'permanently_closed' | 'fake_rewards' | 'offensive_content' | 'other') => void
  reportDetail: string; setReportDetail: (v: string) => void; reporting: boolean; reportError: string; reportSuccess: boolean
  onSubmit: () => void; onClose: () => void; t: (key: string, fallback?: string) => string
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-5">
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
        <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">{t('node.report', 'Report venue')}</h3>
        {reportSuccess ? (
          <p className="text-[var(--success)] text-sm">{t('node.reportSuccess', 'Thanks — our team will review this.')}</p>
        ) : (
          <>
            <p className="text-[var(--text-secondary)] text-sm mb-4">{t('node.reportPrompt', 'What would you like to report?')}</p>
            {reportError && <p className="text-[var(--danger)] text-sm mb-3">{reportError}</p>}
            <div className="flex flex-col gap-3 mb-4">
              <select value={reportType} onChange={(e) => setReportType(e.target.value as 'other')} className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none">
                <option value="wrong_location">Wrong location</option>
                <option value="permanently_closed">Permanently closed</option>
                <option value="fake_rewards">Fake rewards</option>
                <option value="offensive_content">Offensive content</option>
                <option value="other">Other</option>
              </select>
              <textarea value={reportDetail} onChange={(e) => setReportDetail(e.target.value.slice(0, 200))} placeholder="Tell us more" rows={3} maxLength={200} className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none resize-none" />
            </div>
            <div className="flex flex-row gap-3">
              <button onClick={onClose} className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm">Cancel</button>
              <button onClick={onSubmit} disabled={reporting} className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">{reporting ? 'Submitting…' : 'Submit'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ClaimModal({ claiming, claimError, claimSuccess, registrationNumber, setRegistrationNumber, onSubmit, onClose, t }: {
  claiming: boolean; claimError: string; claimSuccess: boolean; registrationNumber: string
  setRegistrationNumber: (v: string) => void; onSubmit: () => void; onClose: () => void; t: (key: string, fallback?: string) => string
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-5">
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
        <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">{t('node.claimVenue')}</h3>
        <p className="text-[var(--text-secondary)] text-sm mb-4">{t('node.claimDescription')}</p>
        {claimSuccess && <p className="text-[var(--success)] text-sm mb-4">{t('node.claimSuccess')}</p>}
        {claimError && <p className="text-[var(--danger)] text-sm mb-4">{claimError}</p>}
        {!claimSuccess && (
          <>
            <div className="flex flex-col gap-3 mb-4">
              <label className="text-[var(--text-primary)] text-xs font-medium">{t('node.cipcNumber')}</label>
              <input type="text" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} placeholder="YYYY/NNNNNN/NN" className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none" />
              <p className="text-[var(--text-muted)] text-xs">{t('node.cipcFormat')}</p>
            </div>
            <div className="flex flex-row gap-3">
              <button onClick={onClose} className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm">Cancel</button>
              <button onClick={onSubmit} disabled={claiming || !registrationNumber.trim()} className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">{claiming ? 'Claiming…' : 'Submit'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function openDirections(lat: number, lng: number, name: string): void {
  const encodedName = encodeURIComponent(name)
  const ua = navigator.userAgent.toLowerCase()
  const isIOS = /iphone|ipad|ipod/.test(ua)
  const isAndroid = /android/.test(ua)

  if (isIOS) {
    window.open(`maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodedName}`, '_blank')
  } else if (isAndroid) {
    window.open(`geo:${lat},${lng}?q=${lat},${lng}(${encodedName})`, '_blank')
  } else {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank')
  }
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`
  return `${km.toFixed(1)}km`
}

function getCtaInfo(
  geoStatus: GeoStatus,
  qrFallback: boolean,
  tooFar: boolean,
  inCooldown: boolean,
  t: (key: string) => string,
): { label: string; disabled: boolean } {
  if (inCooldown) return { label: t('checkin.alreadyCheckedIn'), disabled: true }
  if (qrFallback) return { label: t('checkin.scanQr'), disabled: true }
  if (tooFar) return { label: t('checkin.tooFarButton'), disabled: true }
  switch (geoStatus) {
    case 'requesting': return { label: t('checkin.locating'), disabled: true }
    case 'denied': return { label: t('checkin.button'), disabled: true }
    case 'poorAccuracy': return { label: t('checkin.weakSignal'), disabled: false }
    case 'timeout': return { label: t('checkin.locationUnavailable'), disabled: false }
    default: return { label: t('checkin.button'), disabled: false }
  }
}
