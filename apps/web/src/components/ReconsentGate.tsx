/**
 * Consumer re-consent gate (Release Quality & Ops Hygiene, Requirement 8).
 *
 * When a signed-in consumer's most recently recorded consent version is older
 * than the current required version (`AREA_CODE_CONSENT_VERSION`), this shows
 * exactly one Bottom_Sheet asking them to accept the updated terms. Accepting
 * records the current version via PUT /v1/users/me/consent, preserving their
 * existing analytics preference, and closes the sheet so it does not reappear.
 *
 * The "needs re-consent" comparison lives on the server (GET
 * /v1/users/me/consent -> `needsReconsent`); this component only reacts to it.
 * A failed accept fails closed: the sheet stays open and shows a specific
 * message rather than silently swallowing the error.
 */
import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import { Spinner } from '@area-code/shared/components/Spinner'
import { api, type ApiError } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import type { ConsentStatus } from '@area-code/shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AppRoute } from '../types'

interface ReconsentGateProps {
  onNavigate: (route: AppRoute) => void
}

export function ReconsentGate({ onNavigate }: ReconsentGateProps) {
  const { t } = useTranslation()
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)

  const [status, setStatus] = useState<ConsentStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const checkedRef = useRef(false)

  // Read the consent status once per authenticated session and open the sheet
  // only when the server reports the recorded version is behind the current
  // one. A transient read failure never fakes a prompt or blocks the app.
  useEffect(() => {
    if (!isAuthenticated || checkedRef.current) return
    checkedRef.current = true
    let cancelled = false
    async function checkConsent() {
      try {
        const result = await api.get<ConsentStatus>('/v1/users/me/consent')
        if (cancelled) return
        setStatus(result)
        if (result.needsReconsent) setOpen(true)
      } catch {
        // Reading consent is best-effort on open. Leaving the gate closed on a
        // transient failure is correct: the next fresh open re-checks.
      }
    }
    void checkConsent()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  const handleAccept = useCallback(async () => {
    if (!status || saving) return
    setSaving(true)
    setError(null)
    try {
      // Preserve the user's existing analytics preference; this is a terms
      // re-consent, not an analytics change.
      await api.put('/v1/users/me/consent', {
        consentVersion: status.currentVersion,
        analyticsOptIn: status.analyticsOptIn,
      })
      // Record locally so the sheet closes and does not reappear this session.
      setStatus({ ...status, recordedVersion: status.currentVersion, needsReconsent: false })
      setOpen(false)
    } catch (err) {
      const apiErr = err as ApiError
      const message =
        apiErr.statusCode === 0
          ? t('consent.reconsent.errorNetwork', 'We could not reach the server. Check your connection and try again.')
          : (apiErr.message ?? t('consent.reconsent.errorGeneric', 'We could not save your consent. Please try again.'))
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [status, saving, t])

  if (!isAuthenticated || !open || !status) return null

  return (
    <BottomSheet isOpen={open} onClose={() => setOpen(false)}>
      <div className="flex flex-col gap-4">
        <h2 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
          {t('consent.reconsent.title', 'We updated our terms')}
        </h2>
        <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
          {t(
            'consent.reconsent.body',
            'Our Terms of Service have changed, including a clause confirming your tier and visit count are permanent. Please review and accept to keep using Area Code.',
          )}
        </p>

        <button
          onClick={() => onNavigate('legal-terms')}
          className="self-start min-h-[44px] text-[var(--accent)] text-sm font-medium underline underline-offset-2 transition-all duration-150 active:scale-95"
        >
          {t('consent.reconsent.readTerms', 'Read the updated terms')}
        </button>

        <button
          onClick={() => void handleAccept()}
          disabled={saving}
          className="min-h-[44px] bg-[var(--accent-cta)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? (
            <Spinner size="sm" className="border-white border-t-transparent" />
          ) : (
            t('consent.reconsent.accept', 'Accept and continue')
          )}
        </button>

        {error && (
          <p className="text-[var(--danger)] text-xs text-center" role="alert">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  )
}
