import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'

interface StaffMember {
  id: string
  name: string
}

interface StaffRedemption {
  redemptionId: string
  staffName: string
  rewardTitle: string
  redeemedAt: string
}

export function StaffRedemptionPanel() {
  const { t } = useTranslation()
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState<string>('')
  const [redemptions, setRedemptions] = useState<StaffRedemption[]>([])
  const [loading, setLoading] = useState(false)

  // Fetch staff list
  useEffect(() => {
    async function fetchStaff() {
      try {
        const res = await api.get<{ items: StaffMember[] }>('/v1/business/staff')
        setStaff(res.items ?? [])
      } catch {
        // Fail silently
      }
    }
    fetchStaff()
  }, [])

  // Fetch redemptions when staff is selected
  useEffect(() => {
    if (!selectedStaffId) {
      setRedemptions([])
      return
    }
    async function fetchRedemptions() {
      setLoading(true)
      try {
        const res = await api.get<{ items: StaffRedemption[] }>(
          `/v1/business/staff/${selectedStaffId}/redemptions`,
        )
        setRedemptions(res.items)
      } catch {
        setRedemptions([])
      } finally {
        setLoading(false)
      }
    }
    fetchRedemptions()
  }, [selectedStaffId])

  return (
    <div className="p-5 flex flex-col gap-4">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
        {t('biz.panel.staffRedemptions', 'Staff Redemptions')}
      </h2>

      {/* Staff filter dropdown */}
      <select
        value={selectedStaffId}
        onChange={(e) => setSelectedStaffId(e.target.value)}
        className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none appearance-none"
        aria-label="Filter by staff member"
      >
        <option value="">All staff members</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      {loading && (
        <div className="text-[var(--text-muted)] text-sm text-center py-8">Loading...</div>
      )}

      {!loading && selectedStaffId && redemptions.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm text-center py-8">
          No redemptions found for this staff member
        </div>
      )}

      {!loading && !selectedStaffId && (
        <div className="text-[var(--text-muted)] text-sm text-center py-8">
          Select a staff member to view their redemptions
        </div>
      )}

      <div className="flex flex-col gap-2">
        {redemptions.map((rdm) => (
          <div
            key={rdm.redemptionId}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-row items-center justify-between"
          >
            <div className="flex flex-col gap-1">
              <span className="text-[var(--text-primary)] font-medium text-sm">
                {rdm.staffName}
              </span>
              <span className="text-[var(--text-secondary)] text-xs">
                {rdm.rewardTitle}
              </span>
            </div>
            <span className="text-[var(--text-muted)] text-xs">
              {new Date(rdm.redeemedAt).toLocaleString([], {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
