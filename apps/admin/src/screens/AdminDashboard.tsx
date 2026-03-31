import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAdminAuthStore } from '../stores/adminAuthStore'
import { ConsumerManagement } from './ConsumerManagement'
import { BusinessManagement } from './BusinessManagement'
import { ReportQueue } from './ReportQueue'
import { ConsentAudit } from './ConsentAudit'
import { ArchetypeManagement } from '../components/ArchetypeManagement'
import { GenreWeightEditor } from '../components/GenreWeightEditor'

type Tab = 'consumers' | 'businesses' | 'reports' | 'consent' | 'archetypes' | 'genre-weights'

const TAB_LABELS: Record<Tab, string> = {
  consumers: 'admin.nav.consumers',
  businesses: 'admin.nav.businesses',
  reports: 'admin.nav.reports',
  consent: 'admin.nav.consent',
  archetypes: 'admin.nav.archetypes',
  'genre-weights': 'admin.nav.genreWeights',
}

function getVisibleTabs(role: string | null): Tab[] {
  switch (role) {
    case 'super_admin':
      return ['consumers', 'businesses', 'reports', 'consent', 'archetypes', 'genre-weights']
    case 'support_agent':
      return ['consumers', 'businesses']
    case 'content_moderator':
      return ['reports']
    default:
      return []
  }
}

export function AdminDashboard() {
  const { t } = useTranslation()
  const { role, logout } = useAdminAuthStore()
  const tabs = getVisibleTabs(role)
  const [activeTab, setActiveTab] = useState<Tab>(tabs[0] ?? 'consumers')

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
      <header className="flex flex-row items-center justify-between px-5 py-4 border-b border-[var(--border)]">
        <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
          Area Code Admin
        </span>
        <div className="flex flex-row items-center gap-4">
          <span className="text-[var(--text-muted)] text-xs uppercase">{role}</span>
          <button onClick={logout} className="text-[var(--text-muted)] text-sm">
            {t('admin.logout')}
          </button>
        </div>
      </header>

      <nav className="flex flex-row gap-1 px-5 pt-3 pb-2 border-b border-[var(--border)]">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-xl text-sm transition-all duration-150 ${
              activeTab === tab
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t(TAB_LABELS[tab])}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto">
        {activeTab === 'consumers' && <ConsumerManagement />}
        {activeTab === 'businesses' && <BusinessManagement />}
        {activeTab === 'reports' && <ReportQueue />}
        {activeTab === 'consent' && <ConsentAudit />}
        {activeTab === 'archetypes' && <ArchetypeManagement />}
        {activeTab === 'genre-weights' && <GenreWeightEditor />}
      </main>
    </div>
  )
}
