import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAdminAuthStore } from '../stores/adminAuthStore'
import { DashboardOverview } from './DashboardOverview'
import { ConsumerManagement } from './ConsumerManagement'
import { BusinessManagement } from './BusinessManagement'
import { NodeManagement } from './NodeManagement'
import { ReportQueue } from './ReportQueue'
import { ConsentAudit } from './ConsentAudit'
import { AbuseFlagDashboard } from './AbuseFlagDashboard'
import { AuditTrailViewer } from './AuditTrailViewer'
import { ArchetypeManagement } from '../components/ArchetypeManagement'
import { GenreWeightEditor } from '../components/GenreWeightEditor'
import { AdminIAM } from './AdminIAM'

type Tab = 'dashboard' | 'consumers' | 'businesses' | 'nodes' | 'reports' | 'abuse-flags' | 'audit-trail' | 'consent' | 'archetypes' | 'genre-weights' | 'iam'

const TAB_LABELS: Record<Tab, string> = {
  dashboard: 'admin.nav.dashboard',
  consumers: 'admin.nav.consumers',
  businesses: 'admin.nav.businesses',
  nodes: 'admin.nav.nodes',
  reports: 'admin.nav.reports',
  'abuse-flags': 'admin.nav.abuseFlags',
  'audit-trail': 'admin.nav.auditTrail',
  consent: 'admin.nav.consent',
  archetypes: 'admin.nav.archetypes',
  'genre-weights': 'admin.nav.genreWeights',
  iam: 'admin.nav.iam',
}

function getVisibleTabs(role: string | null): Tab[] {
  switch (role) {
    case 'super_admin':
      return ['dashboard', 'consumers', 'businesses', 'nodes', 'reports', 'abuse-flags', 'audit-trail', 'consent', 'archetypes', 'genre-weights', 'iam']
    case 'support_agent':
      return ['consumers', 'businesses']
    case 'content_moderator':
      return ['reports', 'abuse-flags']
    default:
      return []
  }
}

export function AdminDashboard() {
  const { t } = useTranslation()
  const { role, logout } = useAdminAuthStore()
  const tabs = getVisibleTabs(role)
  const [activeTab, setActiveTab] = useState<Tab>(tabs[0] ?? 'dashboard')

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
      <header className="flex flex-row items-center justify-between px-5 py-4 border-b border-[var(--border)]">
        <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
          Area Code Admin
        </span>
        <div className="flex flex-row items-center gap-4">
          <span className="text-[var(--text-muted)] text-xs capitalize">{role?.replace(/_/g, ' ')}</span>
          <button onClick={logout} className="text-[var(--text-muted)] text-sm">
            {t('admin.logout')}
          </button>
        </div>
      </header>

      <nav className="flex flex-row gap-1 px-5 pt-3 pb-2 border-b border-[var(--border)] overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm transition-all duration-150 whitespace-nowrap ${
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
        {activeTab === 'dashboard' && <DashboardOverview />}
        {activeTab === 'consumers' && <ConsumerManagement />}
        {activeTab === 'businesses' && <BusinessManagement />}
        {activeTab === 'nodes' && <NodeManagement />}
        {activeTab === 'reports' && <ReportQueue />}
        {activeTab === 'abuse-flags' && <AbuseFlagDashboard />}
        {activeTab === 'audit-trail' && <AuditTrailViewer />}
        {activeTab === 'consent' && <ConsentAudit />}
        {activeTab === 'archetypes' && <ArchetypeManagement />}
        {activeTab === 'genre-weights' && <GenreWeightEditor />}
        {activeTab === 'iam' && <AdminIAM />}
      </main>
    </div>
  )
}
