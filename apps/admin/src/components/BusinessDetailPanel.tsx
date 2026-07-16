import { api } from '@area-code/shared/lib/api'
import type { BusinessAccount, ClaimCipcStatus, ClaimStatus } from '@area-code/shared/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface BusinessNode {
  id: string
  name: string
  slug: string
  claimStatus?: ClaimStatus
  claimCipcStatus?: ClaimCipcStatus
  claimRegistrationNumber?: string
}

interface BusinessStaff {
  id: string
  name?: string
  email?: string
  phone?: string
  isActive?: boolean
}

interface BusinessDetailData extends BusinessAccount {
  nodes: BusinessNode[]
  staffAccounts: BusinessStaff[]
}

function formatDate(value?: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

export function BusinessDetailPanel({ businessId, onClose }: { businessId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<BusinessDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const d = await api.get<BusinessDetailData>(`/v1/admin/businesses/${businessId}`)
        if (!cancelled) setDetail(d)
      } catch {
        if (!cancelled) setError('Failed to load business details. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [businessId])

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-5">
      <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-lg w-full shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex flex-row items-center justify-between mb-4">
          <h3 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
            {t('admin.businesses.details', 'Business Details')}
          </h3>
          <button onClick={onClose} className="text-[var(--text-muted)] text-sm">
            Close
          </button>
        </div>

        {loading ? (
          <p className="text-[var(--text-muted)] text-sm">Loading...</p>
        ) : error ? (
          <p className="text-[var(--danger)] text-sm">{error}</p>
        ) : detail ? (
          <div className="flex flex-col gap-5 overflow-y-auto">
            <Overview detail={detail} />
            <Nodes nodes={detail.nodes} />
            <Staff staff={detail.staffAccounts} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Overview({ detail }: { detail: BusinessDetailData }) {
  return (
    <section className="flex flex-col gap-1">
      <span className="text-[var(--text-primary)] font-medium">{detail.businessName}</span>
      <span className="text-[var(--text-muted)] text-xs">{detail.email}</span>
      <div className="text-[var(--text-secondary)] text-xs mt-1">
        Tier: <span className="capitalize">{detail.tier}</span> · Status: {detail.isActive ? 'active' : 'disabled'}
      </div>
      <div className="text-[var(--text-secondary)] text-xs">
        Registration: {detail.registrationNumber ?? '-'} · Trial ends: {formatDate(detail.trialEndsAt)}
      </div>
      <div className="text-[var(--text-secondary)] text-xs">Joined: {formatDate(detail.createdAt)}</div>
    </section>
  )
}

function Nodes({ nodes }: { nodes: BusinessNode[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[var(--text-primary)] text-sm font-semibold">Venues</h4>
      {nodes.length === 0 ? (
        <p className="text-[var(--text-muted)] text-xs">No venues.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {nodes.map((n) => (
            <div
              key={n.id}
              className="flex flex-row items-center justify-between bg-[var(--bg-raised)] rounded-xl px-3 py-2"
            >
              <div className="flex flex-col min-w-0 mr-3">
                <span className="text-[var(--text-primary)] text-xs truncate">{n.name}</span>
                {n.claimRegistrationNumber && (
                  <span className="text-[var(--text-muted)] text-xs truncate">CIPC: {n.claimRegistrationNumber}</span>
                )}
              </div>
              <div className="flex flex-col items-end flex-shrink-0">
                {n.claimStatus && <span className="text-[var(--text-muted)] text-xs capitalize">{n.claimStatus}</span>}
                {n.claimCipcStatus && (
                  <span className="text-[var(--text-muted)] text-xs">{n.claimCipcStatus.replaceAll('_', ' ')}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Staff({ staff }: { staff: BusinessStaff[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[var(--text-primary)] text-sm font-semibold">Staff</h4>
      {staff.length === 0 ? (
        <p className="text-[var(--text-muted)] text-xs">No staff members.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {staff.map((s) => (
            <div
              key={s.id}
              className="flex flex-row items-center justify-between bg-[var(--bg-raised)] rounded-xl px-3 py-2"
            >
              <span className="text-[var(--text-primary)] text-xs truncate mr-3">
                {s.name ?? s.email ?? s.phone ?? s.id}
              </span>
              {s.isActive === false && <span className="text-[var(--danger)] text-xs flex-shrink-0">Revoked</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
