import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldOff, Info, X } from 'lucide-react'

import { api } from '@area-code/shared/lib/api'
import { useStaffAuthStore } from '../stores/staffAuthStore'
import { StaffValidator } from '../components/StaffValidator'
import { RecentRedemptions } from '../components/RecentRedemptions'

export function StaffHome() {
  const { t } = useTranslation()
  const { staffName, businessId, logout } = useStaffAuthStore()
  const [businessName, setBusinessName] = useState<string | null>(null)
  const [businessDeactivated, setBusinessDeactivated] = useState(false)
  const [showTip, setShowTip] = useState(() => !localStorage.getItem('staff:tipDismissed'))

  useEffect(() => {
    if (!businessId) return
    void api.get<{ businessName?: string; isActive?: boolean }>('/v1/staff/business').then((res) => {
      if (res.businessName) setBusinessName(res.businessName)
      if (res.isActive === false) setBusinessDeactivated(true)
    }).catch((err: any) => {
      // Only treat 403 as deactivation (explicit denial).
      // 404 means the endpoint isn't deployed yet — don't block the user.
      if (err?.statusCode === 403) setBusinessDeactivated(true)
    })
  }, [businessId])

  if (businessDeactivated) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh px-6 bg-[var(--bg-base)] gap-4">
        <ShieldOff size={32} strokeWidth={1.5} className="text-[var(--danger)]" />
        <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] text-center">Business deactivated</h1>
        <p className="text-[var(--text-secondary)] text-sm text-center">This business account has been deactivated. Contact the business owner for more information.</p>
        <button onClick={logout} className="text-[var(--accent)] text-sm font-medium">Sign out</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
      <header className="flex flex-row items-center justify-between px-5 py-4 border-b border-[var(--border)]">
        <div className="flex flex-col">
          <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
            {staffName ?? 'Area Code'}
          </span>
          {businessName && (
            <span className="text-[var(--text-muted)] text-xs">{businessName}</span>
          )}
        </div>
        <button
          onClick={logout}
          className="text-[var(--text-muted)] text-sm"
        >
          {t('staff.logout')}
        </button>
      </header>

      {showTip && (
        <div className="mx-5 mt-4 p-4 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl flex flex-row items-start gap-3">
          <Info size={18} className="text-[var(--accent)] flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[var(--text-primary)] text-sm font-medium mb-1">
              {t('staff.tip.title', 'How to validate a reward')}
            </p>
            <p className="text-[var(--text-secondary)] text-xs">
              {t('staff.tip.body', 'When a customer shows their reward code, enter it below or scan their QR. You\'ll see the reward details before confirming.')}
            </p>
          </div>
          <button
            onClick={() => { localStorage.setItem('staff:tipDismissed', '1'); setShowTip(false) }}
            className="text-[var(--text-muted)] text-xs"
            aria-label="Dismiss tip"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <StaffValidator />
      <RecentRedemptions />
    </div>
  )
}
