import { api } from '@area-code/shared/lib/api'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Tier = 'starter' | 'growth' | 'pro'

interface SetTierDialogProps {
  businessId: string
  initialTier: Tier
  onClose: () => void
  onSaved: () => void
}

// A datetime-local value string (YYYY-MM-DDTHH:mm) for now + 1 calendar month,
// the default Comp_Window length (R1.4).
function defaultCompEnd(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Admin set-tier dialog (cross-portal-lifecycle-alignment R1). A paid tier is a
// Comp_Window: it requires an entitlement end date (default +1 month) written to
// Paid_Until, so the Tier_Resolver treats the comp exactly like a paid window and
// map removal on lapse follows the normal grace flow. Starter forbids the date.
export function SetTierDialog({ businessId, initialTier, onClose, onSaved }: SetTierDialogProps) {
  const { t } = useTranslation()
  const [tier, setTier] = useState<Tier>(initialTier)
  const [reason, setReason] = useState('')
  const [paidUntil, setPaidUntil] = useState(initialTier === 'starter' ? '' : defaultCompEnd())
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  const isPaid = tier === 'growth' || tier === 'pro'

  function handleTierChange(next: Tier) {
    setTier(next)
    // Seed the comp end date when moving to a paid tier; clear it for starter so
    // the request never carries a forbidden window.
    if (next === 'starter') setPaidUntil('')
    else if (!paidUntil) setPaidUntil(defaultCompEnd())
  }

  async function handleSave() {
    if (!reason.trim()) return
    if (isPaid && !paidUntil.trim()) {
      setError('Paid tiers require an entitlement end date.')
      return
    }
    setError('')
    setSuccess(false)
    setSaving(true)
    try {
      const body: { tier: Tier; reason: string; paidUntil?: string } = {
        tier,
        reason: reason.trim(),
      }
      if (isPaid) {
        const date = new Date(paidUntil.trim())
        if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
          setError('Entitlement end date must be in the future.')
          setSaving(false)
          return
        }
        body.paidUntil = date.toISOString()
      }
      await api.post(`/v1/admin/businesses/${businessId}/set-tier`, body)
      setSuccess(true)
      setTimeout(() => {
        onSaved()
        onClose()
      }, 1200)
    } catch (err: unknown) {
      setError((err as { message?: string })?.message || 'Failed to set tier')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-5">
      <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">
          {t('admin.businesses.setTier')}
        </h3>
        <p className="text-[var(--text-secondary)] text-sm mb-4">Assign a subscription plan to this business.</p>
        {success && <p className="text-[var(--success)] text-sm mb-4">Tier updated successfully!</p>}
        {error && <p className="text-[var(--danger)] text-sm mb-4">{error}</p>}
        {!success && (
          <>
            <div className="flex flex-col gap-3 mb-4">
              <label className="text-[var(--text-primary)] text-xs font-medium">Plan</label>
              <select
                value={tier}
                onChange={(e) => handleTierChange(e.target.value as Tier)}
                className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="pro">Pro</option>
              </select>
              <label className="text-[var(--text-primary)] text-xs font-medium">Reason (required)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Promotion, Payment failure compensation, Enterprise deal"
                rows={3}
                className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none resize-none"
              />
              {isPaid && (
                <>
                  <label className="text-[var(--text-primary)] text-xs font-medium">Entitlement end date</label>
                  <input
                    type="datetime-local"
                    value={paidUntil}
                    onChange={(e) => setPaidUntil(e.target.value)}
                    className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
                  />
                  <p className="text-[var(--text-muted)] text-xs">
                    The venue counts as paid until this date. On lapse it follows the normal grace flow, then map
                    removal, exactly like a paid subscription.
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-row gap-3">
              <button
                onClick={onClose}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={!reason.trim() || saving}
                className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
              >
                Set Tier
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
