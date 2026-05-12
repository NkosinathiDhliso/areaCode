import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { useStaffAuthStore } from '../stores/staffAuthStore'
import { StaffValidator } from '../components/StaffValidator'
import { RecentRedemptions } from '../components/RecentRedemptions'

export function StaffHome() {
  const { t } = useTranslation()
  const { staffName, businessId, logout } = useStaffAuthStore()
  const [businessName, setBusinessName] = useState<string | null>(null)

  useEffect(() => {
    if (!businessId) return
    void api.get<{ businessName?: string }>('/v1/staff/business').then((res) => {
      if (res.businessName) setBusinessName(res.businessName)
    }).catch(() => {
      // Best effort — don't block the UI
    })
  }, [businessId])

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

      <StaffValidator />
      <RecentRedemptions />
    </div>
  )
}
