import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldOff } from 'lucide-react'

import { api } from '@area-code/shared/lib/api'
import { useStaffAuthStore } from '../stores/staffAuthStore'
import { StaffValidator } from '../components/StaffValidator'
import { RecentRedemptions } from '../components/RecentRedemptions'
import { MyRank } from '../components/MyRank'
import { FirstGetIssuer } from '../components/FirstGetIssuer'

export function StaffHome() {
  const { t } = useTranslation()
  const { staffName, businessId, logout } = useStaffAuthStore()
  const [businessName, setBusinessName] = useState<string | null>(null)
  const [businessDeactivated, setBusinessDeactivated] = useState(false)

  useEffect(() => {
    if (!businessId) return
    void api
      .get<{ businessName?: string; isActive?: boolean }>('/v1/staff/business')
      .then((res) => {
        if (res.businessName) setBusinessName(res.businessName)
        if (res.isActive === false) setBusinessDeactivated(true)
      })
      .catch((err: unknown) => {
        // Only treat 403 as deactivation (explicit denial).
        // 404 means the endpoint isn't deployed yet - don't block the user.
        if ((err as { statusCode?: number })?.statusCode === 403) setBusinessDeactivated(true)
      })
  }, [businessId])

  if (businessDeactivated) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-dvh px-6 bg-[var(--bg-base)] gap-4"
        style={{
          paddingTop: 'max(2rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        }}
      >
        <ShieldOff size={32} strokeWidth={1.5} className="text-[var(--danger)]" />
        <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] text-center">Business deactivated</h1>
        <p className="text-[var(--text-secondary)] text-sm text-center">
          This business account has been deactivated. Contact the business owner for more information.
        </p>
        <button onClick={logout} className="text-[var(--accent)] text-sm font-medium">
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
      <header
        className="flex flex-row items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}
      >
        <div className="flex flex-col">
          <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">{staffName ?? 'Area Code'}</span>
          {businessName && <span className="text-[var(--text-muted)] text-xs">{businessName}</span>}
        </div>
        <button onClick={logout} className="text-[var(--text-muted)] text-sm">
          {t('staff.logout')}
        </button>
      </header>

      {/*
        Single scroll container for the whole shift surface. Previously these
        sections were stacked directly in the h-dvh column with only
        RecentRedemptions set to flex-1/overflow - on short phones the
        validator + first-get + rank cards alone overflowed the viewport, the
        scroll region collapsed to zero height, and the lower cards were cut
        off and unreachable. A plain block scroll wrapper lets the entire
        surface scroll as one, with bottom safe-area padding so the last card
        clears the home indicator.
      */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        data-scroll-container
      >
        <StaffValidator />
        <FirstGetIssuer />
        <MyRank />
        <RecentRedemptions />
      </div>
    </div>
  )
}
