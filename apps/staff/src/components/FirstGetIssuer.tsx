/**
 * Staff-side First-Get token issuer.
 *
 * Walk-in customer at the till, no app account. Staff picks the venue's
 * First-Get reward, taps "Issue token", reads the token aloud (or prints it,
 * or shows the screen). Customer takes it home and redeems on signup.
 *
 * Defends against §1.6 of docs/CHURN_DEFENSES.md (members vs casuals).
 *
 * The component is a single self-contained card that fetches the venue's
 * First-Get on mount and renders nothing if the venue hasn't configured one.
 */

import { useEffect, useState } from 'react'
import { Gift, Printer, X } from 'lucide-react'

import { api, type ApiError } from '@area-code/shared/lib/api'

interface FirstGet {
  rewardId: string
  title: string
  description: string
  nodeId: string
}

type Phase = 'idle' | 'issuing' | 'displayed'

interface IssuedToken {
  token: string
  expiresAt: string
}

export function FirstGetIssuer() {
  const [reward, setReward] = useState<FirstGet | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [issued, setIssued] = useState<IssuedToken | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .get<{ reward: FirstGet | null }>('/v1/staff/first-get')
      .then((res) => {
        if (!cancelled) setReward(res.reward)
      })
      .catch(() => {
        // Silent - venue hasn't set one up
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleIssue() {
    if (!reward) return
    setPhase('issuing')
    setError(null)
    try {
      const res = await api.post<{ token: string; expiresAt: string }>(
        `/v1/staff/first-get/${reward.rewardId}/confirm`,
        {},
      )
      setIssued({ token: res.token, expiresAt: res.expiresAt })
      setPhase('displayed')
    } catch (err) {
      const apiErr = err as ApiError
      setError(apiErr.message ?? 'Could not issue token')
      setPhase('idle')
    }
  }

  function handlePrint() {
    if (!issued || !reward) return
    const w = window.open('', '_blank', 'width=400,height=500')
    if (!w) return
    w.document.write(`<!doctype html>
<html><head><title>Area Code · ${escapeHtml(reward.title)}</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 32px; text-align: center; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #666; font-size: 12px; margin-bottom: 24px; }
  .token {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 56px;
    letter-spacing: 0.18em;
    margin: 24px 0;
    border: 2px solid #000;
    border-radius: 12px;
    padding: 16px 24px;
    display: inline-block;
  }
  .body { font-size: 14px; line-height: 1.5; max-width: 280px; margin: 0 auto; }
  .footer { margin-top: 24px; color: #888; font-size: 11px; }
</style></head><body>
<h1>Your Area Code reward</h1>
<div class="sub">${escapeHtml(reward.title)}</div>
<div class="token">${escapeHtml(issued.token)}</div>
<p class="body">Sign up at <strong>areacode.co.za</strong> and enter this code. Free reward, no card required.</p>
<p class="footer">Code expires ${formatExpiry(issued.expiresAt)}.</p>
<script>window.print(); setTimeout(() => window.close(), 250)</script>
</body></html>`)
    w.document.close()
  }

  function reset() {
    setPhase('idle')
    setIssued(null)
    setError(null)
  }

  if (!reward) return null

  return (
    <section className="px-5 pt-2 pb-3" data-testid="first-get-issuer">
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex flex-row items-center gap-2">
          <Gift size={18} strokeWidth={1.5} className="text-[var(--accent)] shrink-0" />
          <span className="text-[var(--text-primary)] font-semibold text-sm flex-1">First-time customer?</span>
          <span className="text-[var(--text-muted)] text-[10px] uppercase tracking-wide">Free</span>
        </div>
        <p className="text-[var(--text-muted)] text-xs">
          Issue them a one-time code for <strong className="text-[var(--text-secondary)]">{reward.title}</strong>. They
          enter it when they sign up - no phone, no email needed at the till.
        </p>

        {phase === 'idle' && (
          <button
            onClick={() => void handleIssue()}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-2.5 text-sm transition-all active:scale-95"
          >
            Issue token
          </button>
        )}

        {phase === 'issuing' && <div className="text-[var(--text-muted)] text-xs text-center py-2">Issuing…</div>}

        {phase === 'displayed' && issued && (
          <div className="flex flex-col gap-3">
            <div className="bg-[var(--bg-base)] border-2 border-[var(--accent)] rounded-2xl py-4 px-3">
              <div className="text-[var(--text-muted)] text-[10px] uppercase tracking-wide text-center mb-1">
                Read this to the customer
              </div>
              <div
                className="font-mono text-[var(--text-primary)] text-3xl font-bold tracking-[0.25em] text-center select-all"
                aria-label={`Token ${issued.token.split('').join(' ')}`}
              >
                {issued.token}
              </div>
              <div className="text-[var(--text-muted)] text-[10px] text-center mt-2">
                Expires {formatExpiry(issued.expiresAt)}
              </div>
            </div>
            <div className="flex flex-row gap-2">
              <button
                onClick={handlePrint}
                className="flex-1 flex items-center justify-center gap-2 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                <Printer size={14} strokeWidth={1.5} /> Print
              </button>
              <button
                onClick={reset}
                className="flex items-center justify-center gap-2 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-secondary)] rounded-xl py-2.5 px-4 text-sm"
              >
                <X size={14} strokeWidth={1.5} /> Done
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-[var(--danger)] text-xs">{error}</p>}
      </div>
    </section>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatExpiry(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}
