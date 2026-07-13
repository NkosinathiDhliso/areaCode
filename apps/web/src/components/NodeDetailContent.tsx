import { MediaImage } from '@area-code/shared/components/MediaImage'
import { PhotoUnavailable } from '@area-code/shared/components/PhotoUnavailable'
import { SOCIAL_PLATFORMS, socialProfileUrl } from '@area-code/shared/constants/social-platforms'
import { api } from '@area-code/shared/lib/api'
import { mediaUrl } from '@area-code/shared/lib/mediaUrl'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { usePresenceStore } from '@area-code/shared/stores/presenceStore'
import type { Node, Reward, NodeState } from '@area-code/shared/types'
import { useState, memo } from 'react'
import { useTranslation } from 'react-i18next'

import { resolveArchetypeDisplayName } from '../lib/archetypeDisplay'
import { getCtaInfo } from '../lib/checkInCta'

import { ArchetypeGlyph } from './ArchetypeGlyph'
import { CrowdVibeSection } from './CrowdVibeSection'
import { DirectionsSheet } from './DirectionsSheet'
import { MomentumBadge } from './MomentumBadge'
import { QrScannerSheet } from './QrScannerSheet'

/**
 * Live_Archetype id used when no live value has arrived for the node and
 * the node has no `defaultArchetypeId`. Mirrors R7.8's eclectic-fallback
 * rule on the rendering side so the detail content glyph + display name
 * are never blank (R8.10 / R9.6).
 */
const DEFAULT_ARCHETYPE_ID = 'archetype-eclectic'

// ─── Directions ────────────────────────────────────────────────────────────
//
// Directions are presented in a custom picker (`DirectionsSheet`) rather
// than launched directly. iOS doesn't expose a system "default navigation
// app" picker - `maps://` always opens Apple Maps and ignores the user's
// preference for Google Maps or Waze. The sheet gives users an explicit
// choice and falls back to the HTTPS URL if the chosen app isn't installed.

/**
 * `NodeDetailContent` - the full venue detail body (rewards, archetype glyph +
 * display name, crowd-vibe section, directions, and the check-in CTA) for a
 * single venue, **without** the surrounding `BottomSheet`.
 *
 * `PeekCarousel` renders it as the Commit_Mode body on the *same* `BottomSheet`
 * it uses for Browse_Mode, so a Browse↔Commit transition is a state/height
 * change on one sheet rather than a separate detail surface (Requirement 2.5).
 *
 * The component owns the detail-local interaction state (report/claim modals,
 * the QR scanner, the directions picker, reward chip expansion) so callers do
 * not have to thread it through.
 */
export interface NodeDetailContentProps {
  node: Node | null
  rewards: Reward[]
  pulseScore: number
  state: NodeState
  onCheckIn: () => void
  onSignIn: () => void
  qrFallback?: boolean
  isCheckingIn?: boolean
  // Symmetric with onCheckIn/isCheckingIn. Optional because the Commit_Mode
  // parent wires the handler separately (honest-presence-ui task 3.2); until
  // wired, no check-in sets Active_Presence so the Check_Out_CTA stays hidden.
  onCheckOut?: () => void
  isCheckingOut?: boolean
}

export const NodeDetailContent = memo(function NodeDetailContent({
  node,
  rewards,
  state,
  onCheckIn,
  onSignIn,
  qrFallback = false,
  isCheckingIn = false,
  onCheckOut,
  isCheckingOut = false,
}: NodeDetailContentProps) {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)
  const isBusinessAuthenticated = useBusinessAuthStore((s) => s.isAuthenticated)
  const geoStatus = useLocationStore((s) => s.geoStatus)
  // Live_Archetype id for this node - same resolution order as the map
  // marker (`useMapMarkers.ts`): cached live id from the
  // `node:archetype_change` stream, then the node's configured default,
  // then the eclectic fallback per R7.8. Drives the R8.10 / R9.6 glyph
  // and display name in the detail content.
  const archetypeId = useMapStore(
    (s) => (node ? s.archetypeIds[node.id] : undefined) ?? node?.defaultArchetypeId ?? DEFAULT_ARCHETYPE_ID,
  )
  // Honest presence momentum for this venue (filling up / winding down). Seeded
  // by the REST presence read and kept live by `node:presence_update`; renders
  // nothing unless a real trend was measured (honest-presence rule 5).
  const momentum = useMapStore((s) => (node ? s.momentum[node.id] : undefined))
  // Active_Presence for this node: drives whether the Check_Out_CTA replaces
  // the check-in CTA. Read from the shared presence store, never fabricated
  // (honest-presence-ui R1.1, R1.2, R3).
  const isPresent = usePresenceStore((s) => (node ? s.isPresent(node.id) : false))
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
  const [directionsSheetOpen, setDirectionsSheetOpen] = useState(false)
  // Currently expanded reward - tapping a chip toggles it open to show the
  // description, expiry, and slots-remaining details. Customers complained
  // the chips looked tappable but did nothing; this gives the tap a payoff.
  const [expandedRewardId, setExpandedRewardId] = useState<string | null>(null)

  if (!node) return null

  const isDormant = state === 'dormant' && rewards.length === 0
  const activeRewards = rewards.filter((r) => r.isActive)
  const hasHeaderKey = typeof node.headerImageKey === 'string' && node.headerImageKey.trim() !== ''
  const headerImageUrl = mediaUrl(node.headerImageKey)

  function handleCheckIn() {
    if (!isAuthenticated) {
      onSignIn()
      return
    }
    if (qrFallback || geoStatus === 'denied' || geoStatus === 'timeout') {
      // GPS is unusable (out of range, permission denied, or no fix) - open the
      // in-app scanner so the user can scan the venue's printed QR to prove
      // presence. This is the only check-in path that does not need GPS.
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
    // Unknown QR format - tell the user this isn't a valid Area Code QR
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
    // Tag the venue's own social handle in the share text so a customer's post
    // credits the venue (word-of-mouth that points back, not just a link out).
    const links = node!.socialLinks ?? {}
    const primaryHandle = links.instagram ?? links.tiktok ?? links.x ?? links.facebook ?? links.youtube
    const shareText = primaryHandle
      ? t('share.venueTagged', { name: node!.name, handle: `@${primaryHandle}` })
      : t('share.venue', { name: node!.name })
    // Record a completed share so the venue's weekly digest can show an honest
    // "shares recorded" count. Fire-and-forget beacon, never blocks the share
    // and never surfaces an error to the user.
    const recordShare = () => {
      void api.post(`/v1/nodes/${node!.id}/share`, {}).catch(() => {})
    }
    if (navigator.share) {
      void navigator.share({ title: node!.name, text: shareText, url }).then(recordShare, () => {})
    } else {
      void navigator.clipboard.writeText(url).then(
        () => {
          recordShare()
          useErrorStore.getState().showError(t('share.copied', 'Link copied to clipboard'))
        },
        () => useErrorStore.getState().showError(t('share.copyFailed', "Couldn't copy link")),
      )
    }
    setMenuOpen(false)
  }

  function handleDirections() {
    if (node) {
      setDirectionsSheetOpen(true)
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

  const ctaInfo = getCtaInfo({ geoStatus, qrFallback, pending: isCheckingIn })
  const ctaLabel = t(ctaInfo.label)

  return (
    <>
      {/* Header */}
      <div className="flex flex-row items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{node.name}</h2>
          <p className="text-[var(--text-secondary)] text-sm mt-1">
            {node.category} · {state}
          </p>
          {node.socialLinks && Object.keys(node.socialLinks).length > 0 && (
            <div className="flex flex-row flex-wrap gap-x-3 gap-y-1 mt-1">
              {SOCIAL_PLATFORMS.filter((p) => node.socialLinks?.[p.platform]).map((p) => {
                const handle = node.socialLinks![p.platform]!
                return (
                  <a
                    key={p.platform}
                    href={socialProfileUrl(p.platform, handle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${p.label} @${handle}`}
                    className="inline-flex items-center text-[var(--accent)] text-xs transition-transform duration-150 active:scale-95"
                  >
                    {p.label}
                  </a>
                )
              })}
            </div>
          )}
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

      {headerImageUrl ? (
        <MediaImage
          src={headerImageUrl}
          alt={node.name}
          loading="lazy"
          decoding="async"
          className="w-full h-40 object-cover rounded-2xl border border-[var(--border)] mb-4 bg-[var(--bg-raised)]"
          fallbackClassName="w-full h-40 mb-4"
        />
      ) : hasHeaderKey ? (
        <PhotoUnavailable className="w-full h-40 mb-4" />
      ) : null}

      {/* Dormant empty state - "be the first in" (R2.7). */}
      {isDormant ? (
        <p className="text-[var(--text-secondary)] text-sm mb-6">{t('map.beFirst')}</p>
      ) : (
        <>
          {/* Rewards section. Marked `data-rewards-row` so a host gesture layer
              (Peek_Carousel) can route a horizontal drag here to native scroll
              rather than changing the Active_Venue (R7.3). */}
          {activeRewards.length > 0 && (
            <div className="mb-4" data-rewards-row>
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

          {/* Live archetype glyph + display name (R8.10, R9.6).
              `ArchetypeGlyph` positions itself absolutely against its
              parent, so we wrap it in a relative-sized box. The display
              name resolves through `resolveArchetypeDisplayName` which
              emits a non-blocking warning for unknown ids per R9.10. */}
          <div className="flex flex-row items-center gap-2 mb-3">
            <div className="relative w-6 h-6 shrink-0">
              <ArchetypeGlyph archetypeId={archetypeId} pulseState={state} category={node.category} size={24} />
            </div>
            <span className="text-[var(--text-primary)] text-sm font-medium">
              {resolveArchetypeDisplayName(archetypeId)}
            </span>
            <MomentumBadge momentum={momentum} size="md" />
          </div>

          {/* Crowd Vibe section */}
          <CrowdVibeSection nodeId={node.id} />
        </>
      )}

      {/* Get Directions - always visible */}
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

      {/* Claim this venue - for unclaimed nodes when business authenticated */}
      {isBusinessAuthenticated && node.claimStatus === 'unclaimed' && (
        <button
          onClick={() => setClaimModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 bg-[var(--accent-cta)] text-white font-medium rounded-xl py-3 text-sm mb-3 transition-all duration-150 active:scale-95"
        >
          {t('node.claimVenue')}
        </button>
      )}

      {/* CTA: while the user holds Active_Presence here, the Check_Out_CTA
          replaces the check-in button as the primary action (R1.1). Otherwise
          the existing check-in CTA is unchanged (R1.2). */}
      {isPresent ? (
        <button
          onClick={onCheckOut}
          disabled={isCheckingOut}
          aria-disabled={isCheckingOut}
          aria-label={t('node.checkOut')}
          className={`w-full font-semibold rounded-xl py-4 text-base border border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-primary)] transition-all duration-150 active:scale-95 ${
            isCheckingOut ? 'opacity-60 cursor-not-allowed' : ''
          }`}
        >
          {isCheckingOut ? t('node.checkingOut') : t('node.checkOut')}
        </button>
      ) : (
        <button
          onClick={handleCheckIn}
          disabled={ctaInfo.disabled}
          className={`w-full font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 ${
            ctaInfo.disabled
              ? 'bg-[var(--bg-raised)] text-[var(--text-muted)] cursor-not-allowed'
              : 'bg-[var(--accent-cta)] text-white'
          }`}
        >
          {ctaLabel}
        </button>
      )}

      {/* Report Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full max-h-[85dvh] overflow-y-auto shadow-2xl">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">
              {t('node.report', 'Report venue')}
            </h3>
            {reportSuccess ? (
              <p className="text-[var(--success)] text-sm">
                {t('node.reportSuccess', 'Thanks - our team will review this.')}
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
                    className="flex-1 bg-[var(--accent-cta)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full max-h-[85dvh] overflow-y-auto shadow-2xl">
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
                    className="flex-1 bg-[var(--accent-cta)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
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

      <DirectionsSheet
        isOpen={directionsSheetOpen}
        onClose={() => setDirectionsSheetOpen(false)}
        lat={node.lat}
        lng={node.lng}
        name={node.name}
      />
    </>
  )
})
