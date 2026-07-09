import { api } from '@area-code/shared/lib/api'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FirstGetIssuer } from '../components/FirstGetIssuer'
import { LapsedBusinessBanner } from '../components/LapsedBusinessBanner'
import { MyRank } from '../components/MyRank'
import { RecentRedemptions } from '../components/RecentRedemptions'
import { StaffValidator } from '../components/StaffValidator'
import { VibeDeclaration } from '../components/VibeDeclaration'
import { useStaffAuthStore } from '../stores/staffAuthStore'

export function StaffHome() {
  const { t } = useTranslation()
  const { staffName, businessId, logout } = useStaffAuthStore()
  const [businessName, setBusinessName] = useState<string | null>(null)
  const [lapsed, setLapsed] = useState(false)

  useEffect(() => {
    if (!businessId) return
    void api
      .get<{ businessName?: string; isActive?: boolean; businessState?: 'active' | 'lapsed' }>('/v1/staff/business')
      .then((res) => {
        if (res.businessName) setBusinessName(res.businessName)
        // A lapsed business no longer blocks the shift: staff can still validate
        // already-earned codes (R3.2). The banner names the state; the validator
        // stays available. `isActive === false` is a legacy signal kept for
        // older responses that predate `businessState`.
        if (res.businessState === 'lapsed' || res.isActive === false) setLapsed(true)
      })
      .catch((err: unknown) => {
        // Only treat 403 as a lapse (explicit denial). 404 means the endpoint
        // isn't deployed yet - don't degrade the surface.
        if ((err as { statusCode?: number })?.statusCode === 403) setLapsed(true)
      })
  }, [businessId])

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
        {lapsed && <LapsedBusinessBanner />}
        <StaffValidator />
        <FirstGetIssuer />
        <VibeDeclaration />
        <MyRank />
        <RecentRedemptions />
      </div>
    </div>
  )
}
