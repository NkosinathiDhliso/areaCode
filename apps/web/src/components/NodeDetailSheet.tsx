import { useState, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import { api } from '@area-code/shared/lib/api'
import type { Node, Reward, NodeState } from '@area-code/shared/types'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import type { GeoStatus } from '@area-code/shared/stores/locationStore'
import { CrowdVibeSection } from './CrowdVibeSection'
import { QrScannerSheet } from './QrScannerSheet'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'

// ─── Directions Helper ──────────────────────────────────────────────────────

/**
 * Opens the device's default navigation app with directions to the given
 * coordinates. Uses a geo: URI on Android (opens app picker) and Apple Maps
 * URL on iOS. Falls back to Google Maps web on desktop.
 *
 * This approach lets the OS handle app selection — no need to maintain
 * integrations with Waze, Google Maps, Apple Maps, etc.
 */
function openDirections(lat: number, lng: number, name: string): void {
  const encodedName = encodeURIComponent(name)
  const ua = navigator.userAgent.toLowerCase()
  const isIOS = /iphone|ipad|ipod/.test(ua)
  const isAndroid = /android/.test(ua)

  if (isIOS) {
    // Apple Maps — iOS will offer to open in Google Maps/Waze if installed
    window.open(`maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodedName}`, '_blank')
  } else if (isAndroid) {
    // geo: URI triggers Android's app picker (Google Maps, Waze, etc.)
    window.open(`geo:${lat},${lng}?q=${lat},${lng}(${encodedName})`, '_blank')
  } else {
    // Desktop fallback — Google Maps directions
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodedName}`,
      '_blank',
    )
  }
}

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
}

export const NodeDetailSheet = memo(function NodeDetailSheet({
  node,
  rewards,
  state,
  isOpen,
  onClose,
  onCheckIn,
  onSignup,
  qrFallback = false,
  isCheckingIn = false,
  transparentBackdrop = false,
}: NodeDetailSheetProps) {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const isBusinessAuthenticated = useBusinessAuthStore((s) => s.isAuthenticated)
  const geoStatus = useLocationStore((s) => s.geoStatus)
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
  const [qrSheetOpen, setQrSheetOpen] = useState(false)
  // Currently expanded reward — tapping a chip toggles it open to show the
  // description, expiry, and slots-remaining details. Customers complained
  // the chips looked tappable but did nothing; this gives the tap a payoff.
  const [expandedRewardId, setExpandedRewardId] = useState<string | null>(null)

  if (!node) return null

  const isDormant = state === 'dormant' && rewards.length === 0
  const activeRewards = rewards.filter((r) => r.isActive)
  const cdnUrl = import.meta.env['VITE_CDN_URL'] as string | undefined
  const headerImageUrl = node.headerImageKey && cdnUrl ? `${cdnUrl}/${node.headerImageKey}` : null

  function handleCheckIn() {
    if (!isAuthenticated) {
      onSignup()
      return
    }
    if (qrFallback) {
      // Out of GPS range — open the in-app scanner so the user can scan
      // the venue's printed QR to prove presence.
      setQrSheetOpen(true)
      return
    }
    onCheckIn()
  }

  function handleQrScanned(raw: string) {
    setQrSheetOpen(false)
    // The venue's printed QR encodes https://areacode.co.za/qr/{nodeId}/{token}.
    // Navigate to that URL so the deep-link handler runs the check-in flow
    // with the same code path as a native camera scan.
    const match = raw.match(/\/qr\/([^/?#]+)\/([^/?#]+)/)
    if (match) {
      const [, scannedNodeId, scannedToken] = match
      if (scannedNodeId && scannedToken) {
        window.location.href = `/qr/${scannedNodeId}/${scannedToken}`
        return
      }
    }
    // Unknown QR format — tell the user this isn't a valid Area Code QR
    useErrorStore
      .getState()
      .showError(
        t(
          'qr.invalidFormat',
          "That QR code isn't from Area Code. Look for the poster at the venue entrance or counter.",
        ),
      )
  }

  function handleShare() {
    const url = `https://areacode.co.za/node/${node!.slug}`
    if (navigator.share) {
      void navigator.share({ title: node!.name, text: t('share.text'), url }).catch(() => {})
    } else {
      void navigator.clipboard.writeText(url).then(
        () => useErrorStore.getState().showError(t('share.copied', 'Link copied to clipboard')),
        () => useErrorStore.getState().showError(t('share.copyFailed', "Couldn't copy link")),
      )
    }
    setMenuOpen(false)
  }

  function handleDirections() {
    if (node) {
      openDirections(node.lat, node.lng, node.name)
    }
    setMenuOpen(false)
  }

  async function handleSubmitReport() {
    if (!node) return
    setReporting(true)
    setReportError('')
    try {
      await api.post(`/v1/nodes/${node.id}/report`, {
        type: reportType,
        detail: reportDetail.trim() || undefined,
      })
      setReportSuccess(true)
      setTimeout(() => {
        setReportModalOpen(false)
        setReportSuccess(false)
        setReportDetail('')
        setReportType('other')
      }, 1500)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message
      setReportError(msg ?? t('node.reportError', 'Failed to submit report. Please try again.'))
    } finally {
      setReporting(false)
    }
  }

  async function handleClaim() {
    if (!node) return
    setClaiming(true)
    setClaimError('')
    try {
      await api.post(`/v1/nodes/${node.id}/claim`, { registrationNumber: registrationNumber.trim() })
      setClaimSuccess(true)
      setTimeout(() => {
        setClaimModalOpen(false)
        setClaimSuccess(false)
        setRegistrationNumber('')
      }, 2000)
    } catch (err: unknown) {
      setClaimError((err as { message?: string })?.message || t('node.claimError'))
    } finally {
      setClaiming(false)
    }
  }

  const ctaInfo = getCtaInfo(geoStatus, qrFallback, isCheckingIn, t)

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} transparentBackdrop={transparentBackdrop}>
      {/* Header */}
      <div className="flex flex-row items-start justify-between mb-4">
        <div className="flex-1">
          <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{node.name}</h2>
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
              <button
                onClick={handleDirections}
                className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
              >
                {t('node.directions', 'Get directions')}
              </button>
              {isAuthenticated && (
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    setReportModalOpen(true)
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                >
                  {t('node.report')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {headerImageUrl && (
        <img
          src={headerImageUrl}
          alt={node.name}
          className="w-full h-40 object-cover rounded-2xl border border-[var(--border)] mb-4"
        />
      )}

      {/* Dormant empty state */}
      {isDormant ? (
        <p className="text-[var(--text-secondary)] text-sm mb-6">{t('map.beFirst')}</p>
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
                  const slotsLeft = reward.totalSlots ? reward.totalSlots - reward.claimedCount : null
                  const isLow = slotsLeft !== null && slotsLeft <= 5
                  const isExpanded = expandedRewardId === reward.id
                  const expiresLabel = reward.expiresAt
                    ? new Date(reward.expiresAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                      })
                    : null

                  return (
                    <button
                      key={reward.id}
                      type="button"
                      onClick={() => setExpandedRewardId(isExpanded ? null : reward.id)}
                      aria-expanded={isExpanded}
                      aria-label={t('node.rewardDetails', 'Tap for reward details')}
                      className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl px-4 py-3 text-left transition-all duration-150 hover:border-[var(--accent)] focus:outline-none focus:border-[var(--accent)]"
                    >
                      <div className="flex flex-row items-center justify-between gap-3">
                        <span className="text-[var(--text-primary)] text-sm font-medium flex-1 min-w-0">
                          {reward.title}
                        </span>
                        <div className="flex flex-row items-center gap-2 shrink-0">
                          {slotsLeft !== null && (
                            <span
                              className={`text-xs font-medium ${
                                isLow ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'
                              }`}
                            >
                              {slotsLeft} {t('node.left')}
                            </span>
                          )}
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`text-[var(--text-muted)] transition-transform duration-150 ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                            aria-hidden="true"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-col gap-2">
                          {reward.description && (
                            <p className="text-[var(--text-secondary)] text-xs leading-relaxed">{reward.description}</p>
                          )}
                          {expiresLabel && (
                            <p className="text-[var(--text-muted)] text-xs">
                              {t('node.rewardExpires', 'Expires')} {expiresLabel}
                            </p>
                          )}
                          <p className="text-[var(--text-muted)] text-xs">
                            {t(
                              'node.rewardHowTo',
                              'Tap Check In below when you’re at the venue. Show the redemption code to staff to claim.',
                            )}
                          </p>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Crowd Vibe section */}
          <CrowdVibeSection nodeId={node.id} />
        </>
      )}

      {/* Get Directions — always visible */}
      <button
        onClick={handleDirections}
        className="w-full flex items-center justify-center gap-2 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] font-medium rounded-xl py-3 text-sm mb-3 transition-all duration-150 active:scale-95"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="3 11 22 2 13 21 11 13 3 11" />
        </svg>
        {t('node.directions', 'Get directions')}
      </button>

      {/* Claim this venue — for unclaimed nodes when business authenticated */}
      {isBusinessAuthenticated && node.claimStatus === 'unclaimed' && (
        <button
          onClick={() => setClaimModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] text-white font-medium rounded-xl py-3 text-sm mb-3 transition-all duration-150 active:scale-95"
        >
          {t('node.claimVenue')}
        </button>
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

      {/* Report Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">
              {t('node.report', 'Report venue')}
            </h3>
            {reportSuccess ? (
              <p className="text-[var(--success)] text-sm">
                {t('node.reportSuccess', 'Thanks — our team will review this.')}
              </p>
            ) : (
              <>
                <p className="text-[var(--text-secondary)] text-sm mb-4">
                  {t('node.reportPrompt', 'What would you like to report about this venue?')}
                </p>
                {reportError && <p className="text-[var(--danger)] text-sm mb-3">{reportError}</p>}
                <div className="flex flex-col gap-3 mb-4">
                  <label className="text-[var(--text-primary)] text-xs font-medium">
                    {t('node.reportType', 'Reason')}
                  </label>
                  <select
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value as typeof reportType)}
                    className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
                  >
                    <option value="wrong_location">{t('node.report.wrongLocation', 'Wrong location')}</option>
                    <option value="permanently_closed">{t('node.report.closed', 'Permanently closed')}</option>
                    <option value="fake_rewards">{t('node.report.fakeRewards', 'Fake rewards')}</option>
                    <option value="offensive_content">{t('node.report.offensive', 'Offensive content')}</option>
                    <option value="other">{t('node.report.other', 'Other')}</option>
                  </select>
                  <label className="text-[var(--text-primary)] text-xs font-medium">
                    {t('node.reportDetail', 'Additional details (optional)')}
                  </label>
                  <textarea
                    value={reportDetail}
                    onChange={(e) => setReportDetail(e.target.value.slice(0, 200))}
                    placeholder={t('node.reportDetailPlaceholder', 'Tell us more')}
                    rows={3}
                    maxLength={200}
                    className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none resize-none"
                  />
                </div>
                <div className="flex flex-row gap-3">
                  <button
                    onClick={() => {
                      setReportModalOpen(false)
                      setReportError('')
                    }}
                    className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
                  >
                    {t('common.cancel', 'Cancel')}
                  </button>
                  <button
                    onClick={() => void handleSubmitReport()}
                    disabled={reporting}
                    className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
                  >
                    {reporting ? t('common.submitting', 'Submitting…') : t('node.submitReport', 'Submit')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Claim Modal */}
      {claimModalOpen && (
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
                  <input
                    type="text"
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    placeholder="YYYY/NNNNNN/NN"
                    className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <p className="text-[var(--text-muted)] text-xs">{t('node.cipcFormat')}</p>
                </div>
                <div className="flex flex-row gap-3">
                  <button
                    onClick={() => setClaimModalOpen(false)}
                    className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => void handleClaim()}
                    disabled={claiming || !registrationNumber.trim()}
                    className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
                  >
                    {claiming ? t('node.claiming') : t('node.submitClaim')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <QrScannerSheet isOpen={qrSheetOpen} onClose={() => setQrSheetOpen(false)} onScanned={handleQrScanned} />
    </BottomSheet>
  )
})

function getCtaInfo(
  geoStatus: GeoStatus,
  qrFallback: boolean,
  isCheckingIn: boolean,
  t: (key: string) => string,
): { label: string; disabled: boolean } {
  if (isCheckingIn) {
    return { label: t('checkin.checking'), disabled: true }
  }
  if (qrFallback) {
    // Enabled so tapping opens the in-app QR scanner as a fallback to GPS.
    return { label: t('checkin.scanQr'), disabled: false }
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
