import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ArchetypeManagement } from '../components/ArchetypeManagement'
import { GenreWeightEditor } from '../components/GenreWeightEditor'
import { useAdminAuthStore } from '../stores/adminAuthStore'

import { AbuseFlagDashboard } from './AbuseFlagDashboard'
import { AdminIAM } from './AdminIAM'
import { AuditTrailViewer } from './AuditTrailViewer'
import { BoostFloorEditor } from './BoostFloorEditor'
import { BoostPurchaseReport } from './BoostPurchaseReport'
import { BusinessManagement } from './BusinessManagement'
import { ConsentAudit } from './ConsentAudit'
import { ConsumerManagement } from './ConsumerManagement'
import { DashboardOverview } from './DashboardOverview'
import { GraceList } from './GraceList'
import { NodeManagement } from './NodeManagement'
import { ReportQueue } from './ReportQueue'
import { RetentionDashboard } from './RetentionDashboard'
import { SubscriptionPaymentsReport } from './SubscriptionPaymentsReport'

type Tab =
  | 'dashboard'
  | 'retention'
  | 'consumers'
  | 'businesses'
  | 'grace'
  | 'nodes'
  | 'reports'
  | 'abuse-flags'
  | 'audit-trail'
  | 'consent'
  | 'archetypes'
  | 'boost-floors'
  | 'boost-purchases'
  | 'subscription-payments'
  | 'genre-weights'
  | 'iam'

const TAB_LABELS: Record<Tab, string> = {
  dashboard: 'admin.nav.dashboard',
  retention: 'admin.nav.retention',
  consumers: 'admin.nav.consumers',
  businesses: 'admin.nav.businesses',
  grace: 'admin.nav.grace',
  nodes: 'admin.nav.nodes',
  reports: 'admin.nav.reports',
  'abuse-flags': 'admin.nav.abuseFlags',
  'audit-trail': 'admin.nav.auditTrail',
  consent: 'admin.nav.consent',
  archetypes: 'admin.nav.archetypes',
  'boost-floors': 'admin.nav.boostFloors',
  'boost-purchases': 'admin.nav.boostPurchases',
  'subscription-payments': 'admin.nav.subscriptionPayments',
  'genre-weights': 'admin.nav.genreWeights',
  iam: 'admin.nav.iam',
}

function getVisibleTabs(role: string | null): Tab[] {
  switch (role) {
    case 'super_admin':
      return [
        'dashboard',
        'retention',
        'consumers',
        'businesses',
        'grace',
        'nodes',
        'reports',
        'abuse-flags',
        'audit-trail',
        'consent',
        'archetypes',
        'boost-floors',
        'boost-purchases',
        'subscription-payments',
        'genre-weights',
        'iam',
      ]
    case 'support_agent':
      return ['consumers', 'businesses', 'grace', 'boost-purchases', 'subscription-payments']
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

  // A signed-in admin whose role grants no tabs (unrecognized or unprovisioned
  // role) gets an explicit no-access state instead of a tab bar that renders a
  // panel which 403s.
  if (tabs.length === 0) {
    return (
      <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
        <header className="flex flex-row items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">Area Code Admin</span>
          <button onClick={logout} className="text-[var(--text-muted)] text-sm">
            {t('admin.logout')}
          </button>
        </header>
        <main className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-sm">
            <h2 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">No access</h2>
            <p className="text-[var(--text-secondary)] text-sm">
              Your account does not have any permissions assigned. Contact a super admin to have a role provisioned.
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg-base)]">
      <header className="flex flex-row items-center justify-between px-5 py-4 border-b border-[var(--border)]">
        <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">Area Code Admin</span>
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
        {activeTab === 'retention' && <RetentionDashboard />}
        {activeTab === 'consumers' && <ConsumerManagement />}
        {activeTab === 'businesses' && <BusinessManagement />}
        {activeTab === 'grace' && <GraceList />}
        {activeTab === 'nodes' && <NodeManagement />}
        {activeTab === 'reports' && <ReportQueue />}
        {activeTab === 'abuse-flags' && <AbuseFlagDashboard />}
        {activeTab === 'audit-trail' && <AuditTrailViewer />}
        {activeTab === 'consent' && <ConsentAudit />}
        {activeTab === 'archetypes' && <ArchetypeManagement />}
        {activeTab === 'boost-floors' && <BoostFloorEditor />}
        {activeTab === 'boost-purchases' && <BoostPurchaseReport />}
        {activeTab === 'subscription-payments' && <SubscriptionPaymentsReport />}
        {activeTab === 'genre-weights' && <GenreWeightEditor />}
        {activeTab === 'iam' && <AdminIAM />}
      </main>
    </div>
  )
}
