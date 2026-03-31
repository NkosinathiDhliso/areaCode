import { useTranslation } from 'react-i18next'

import { useStaffAuthStore } from '../stores/staffAuthStore'
import { StaffValidator } from '../components/StaffValidator'
import { RecentRedemptions } from '../components/RecentRedemptions'

export function StaffHome() {
  const { t } = useTranslation()
  const { nodeName, logout } = useStaffAuthStore()

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
      <header className="flex flex-row items-center justify-between px-5 py-4 border-b border-[var(--border)]">
        <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
          {nodeName ?? 'Area Code'}
        </span>
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
