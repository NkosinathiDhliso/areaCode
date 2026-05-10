import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { BusinessAccount } from '@area-code/shared/types'
import { useAdminAuthStore } from '../stores/adminAuthStore'

interface BusinessDetail extends BusinessAccount {
  staffCount: number
  nodeCount: number
  activeRewardCount: number
}

export function BusinessManagement() {
  const { t } = useTranslation()
  const role = useAdminAuthStore((s) => s.role)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BusinessDetail[]>([])
  const [selected, setSelected] = useState<BusinessDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [extendTrialError, setExtendTrialError] = useState<string | null>(null)
  const [staffError, setStaffError] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [confirmDisable, setConfirmDisable] = useState<string | null>(null)
  const [extendTrialId, setExtendTrialId] = useState<string | null>(null)
  const [extendDays, setExtendDays] = useState('7')
  const [setTierId, setSetTierId] = useState<string | null>(null)
  const [selectedTier, setSelectedTier] = useState<'starter' | 'growth' | 'pro'>('starter')
  const [tierReason, setTierReason] = useState('')
  const [trialEndsAt, setTrialEndsAt] = useState('')
  const [setTierError, setSetTierError] = useState('')
  const [setTierSuccess, setSetTierSuccess] = useState(false)
  const [staffBizId, setStaffBizId] = useState<string | null>(null)
  const [staffList, setStaffList] = useState<{ id: string; phone?: string; email?: string; isActive?: boolean }[]>([])
  const [staffLoading, setStaffLoading] = useState(false)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  async function handleSearch() {
    if (!query.trim()) return
    setLoading(true)
    setSearchError(null)
    try {
      const res = await api.get<{ items: BusinessDetail[] }>(`/v1/admin/businesses?q=${encodeURIComponent(query)}`)
      setResults(res.items)
    } catch {
      setSearchError('Search failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(action: string, businessId: string) {
    setActionError(null)
    setActionLoading(true)
    try {
      await api.post(`/v1/admin/businesses/${businessId}/${action}`)
      void handleSearch()
    } catch {
      setActionError('Action failed. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleExtendTrial() {
    if (!extendTrialId) return
    const days = parseInt(extendDays, 10)
    if (!days || days < 1 || days > 30) return
    setExtendTrialError(null)
    setActionLoading(true)
    try {
      await api.post(`/v1/admin/businesses/${extendTrialId}/extend-trial`, { days })
      setExtendTrialId(null)
      setExtendDays('7')
      void handleSearch()
    } catch {
      setExtendTrialError('Failed to extend trial. Please try again.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDisableBusiness(businessId: string) {
    setActionError(null)
    setActionLoading(true)
    try {
      await api.post(`/v1/admin/businesses/${businessId}/disable`)
      setConfirmDisable(null)
      void handleSearch()
    } catch {
      setActionError('Failed to disable business. Please try again.')
      setConfirmDisable(null)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleViewStaff(businessId: string) {
    setStaffBizId(businessId)
    setStaffLoading(true)
    setStaffError(null)
    try {
      const res = await api.get<{ items: { id: string; phone?: string; email?: string }[] }>(
        `/v1/admin/businesses/${businessId}/staff`,
      )
      setStaffList(res.items)
    } catch {
      setStaffList([])
      setStaffError('Failed to load staff. Please close and try again.')
    } finally {
      setStaffLoading(false)
    }
  }

  async function handleRevokeStaff(businessId: string, staffId: string) {
    setRevokeError(null)
    setActionLoading(true)
    try {
      await api.post(`/v1/admin/businesses/${businessId}/staff/${staffId}/revoke`)
      setStaffList((prev) => prev.filter((s) => s.id !== staffId))
      setConfirmRevokeId(null)
    } catch {
      setRevokeError('Failed to revoke staff access. Please try again.')
      setConfirmRevokeId(null)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleSetTier() {
    if (!setTierId) return
    if (!tierReason.trim()) return
    setSetTierError('')
    setSetTierSuccess(false)
    try {
      const body: { tier: 'starter' | 'growth' | 'pro'; reason: string; trialEndsAt?: string } = {
        tier: selectedTier,
        reason: tierReason.trim(),
      }
      if (trialEndsAt.trim()) {
        // Convert datetime-local to ISO datetime with timezone
        const date = new Date(trialEndsAt.trim())
        body.trialEndsAt = date.toISOString()
      }
      await api.post(`/v1/admin/businesses/${setTierId}/set-tier`, body)
      setSetTierSuccess(true)
      setTimeout(() => {
        setSetTierId(null)
        setSelectedTier('starter')
        setTierReason('')
        setTrialEndsAt('')
        setSetTierSuccess(false)
        void handleSearch()
      }, 1500)
    } catch (err: unknown) {
      setSetTierError((err as { message?: string })?.message || 'Failed to set tier')
    }
  }

  return (
    <div className="p-5">
      <h2 className="text-[var(--text-primary)] font-bold text-xl mb-4 font-[Syne]">{t('admin.businesses.title')}</h2>

      {searchError && (
        <div className="bg-[var(--danger)]/10 border border-[var(--danger)] rounded-xl p-3 text-[var(--danger)] text-sm mb-4">
          {searchError}
        </div>
      )}
      {actionError && (
        <div className="bg-[var(--danger)]/10 border border-[var(--danger)] rounded-xl p-3 text-[var(--danger)] text-sm mb-4">
          {actionError}
        </div>
      )}

      <div className="flex flex-row gap-3 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search by name or email"
          className="flex-1 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl px-6 py-3 text-sm"
        >
          Search
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {results.map((biz) => (
          <div
            key={biz.id}
            onClick={() => setSelected(selected?.id === biz.id ? null : biz)}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 cursor-pointer"
          >
            <div className="flex flex-row items-center justify-between">
              <span className="text-[var(--text-primary)] font-medium">{biz.businessName}</span>
              <span className="text-[var(--text-muted)] text-xs capitalize">{biz.tier}</span>
            </div>
            <div className="text-[var(--text-secondary)] text-xs mt-1">
              {biz.email} · {biz.nodeCount} nodes · {biz.staffCount} staff · {biz.activeRewardCount} rewards
            </div>

            {selected?.id === biz.id && (
              <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-row flex-wrap gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setExtendTrialId(biz.id)
                    setExtendDays('7')
                  }}
                  className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-3 py-1.5 text-xs"
                >
                  {t('admin.businesses.extendTrial')}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSetTierId(biz.id)
                    setSelectedTier(
                      (['starter', 'growth', 'pro'] as const).includes(biz.tier as 'starter' | 'growth' | 'pro')
                        ? (biz.tier as 'starter' | 'growth' | 'pro')
                        : 'starter',
                    )
                    setTierReason('')
                  }}
                  className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-3 py-1.5 text-xs"
                >
                  {t('admin.businesses.setTier', 'Set Tier')}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleAction('deactivate-rewards', biz.id)
                  }}
                  disabled={actionLoading}
                  className="border border-[var(--danger)] text-[var(--danger)] rounded-xl px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {t('admin.businesses.deactivateRewards')}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleAction('override-cipc', biz.id)
                  }}
                  disabled={actionLoading}
                  className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {t('admin.businesses.overrideCipc')}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleViewStaff(biz.id)
                  }}
                  className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-3 py-1.5 text-xs"
                >
                  {t('admin.businesses.staff')}
                </button>
                {role === 'super_admin' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmDisable(biz.id)
                    }}
                    className="border border-[var(--danger)] text-[var(--danger)] rounded-xl px-3 py-1.5 text-xs font-medium"
                  >
                    {t('admin.businesses.disable', 'Disable Business')}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Extend trial dialog */}
      {extendTrialId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">Extend Trial</h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">How many days to extend the trial? (1–30)</p>
            <input
              type="number"
              min={1}
              max={30}
              value={extendDays}
              onChange={(e) => setExtendDays(e.target.value)}
              className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm mb-4 focus:border-[var(--accent)] focus:outline-none"
            />
            {extendTrialError && <p className="text-[var(--danger)] text-xs mb-3">{extendTrialError}</p>}
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setExtendTrialId(null)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleExtendTrial()}
                disabled={actionLoading}
                className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
              >
                Extend
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disable confirmation dialog */}
      {confirmDisable && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">Disable Business?</h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              This will deactivate all nodes owned by this business. Consumers will no longer be able to check in or
              claim rewards at their venues. This action creates an audit log entry.
            </p>
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setConfirmDisable(null)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDisableBusiness(confirmDisable)}
                disabled={actionLoading}
                className="flex-1 bg-[var(--danger)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
              >
                Disable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Staff Members dialog */}
      {staffBizId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full max-h-[80vh] flex flex-col">
            <div className="flex flex-row items-center justify-between mb-4">
              <h3 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
                {t('admin.businesses.staff')}
              </h3>
              <button
                onClick={() => {
                  setStaffBizId(null)
                  setStaffList([])
                }}
                className="text-[var(--text-muted)] text-sm"
              >
                Close
              </button>
            </div>
            {staffLoading ? (
              <p className="text-[var(--text-muted)] text-sm">Loading...</p>
            ) : staffError ? (
              <p className="text-[var(--danger)] text-sm">{staffError}</p>
            ) : staffList.length === 0 ? (
              <p className="text-[var(--text-muted)] text-sm">No staff members found.</p>
            ) : (
              <div className="flex flex-col gap-2 overflow-y-auto">
                {staffList.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-row items-center justify-between bg-[var(--bg-raised)] rounded-xl px-3 py-2.5"
                  >
                    <div className="flex flex-col min-w-0 mr-3">
                      <span className="text-[var(--text-primary)] text-sm truncate">{s.phone ?? s.email ?? s.id}</span>
                      {!s.isActive && <span className="text-[var(--danger)] text-xs">Revoked</span>}
                    </div>
                    {s.isActive !== false && (
                      <button
                        onClick={() => setConfirmRevokeId(s.id)}
                        className="border border-[var(--danger)] text-[var(--danger)] rounded-lg px-2.5 py-1 text-xs flex-shrink-0"
                      >
                        {t('admin.businesses.revokeStaff')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Revoke staff confirmation */}
      {confirmRevokeId && staffBizId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">Revoke Staff Access?</h3>
            {revokeError && <p className="text-[var(--danger)] text-xs mb-3">{revokeError}</p>}
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              This staff member will immediately lose access to this business. This action creates an audit log entry.
            </p>
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setConfirmRevokeId(null)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleRevokeStaff(staffBizId, confirmRevokeId)}
                disabled={actionLoading}
                className="flex-1 bg-[var(--danger)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
              >
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set Tier dialog */}
      {setTierId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">
              {t('admin.businesses.setTier')}
            </h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">Assign a subscription plan to this business.</p>
            {setTierSuccess && <p className="text-[var(--success)] text-sm mb-4">Tier updated successfully!</p>}
            {setTierError && <p className="text-[var(--danger)] text-sm mb-4">{setTierError}</p>}
            {!setTierSuccess && (
              <>
                <div className="flex flex-col gap-3 mb-4">
                  <label className="text-[var(--text-primary)] text-xs font-medium">Plan</label>
                  <select
                    value={selectedTier}
                    onChange={(e) => setSelectedTier(e.target.value as 'starter' | 'growth' | 'pro')}
                    className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
                  >
                    <option value="starter">Starter</option>
                    <option value="growth">Growth</option>
                    <option value="pro">Pro</option>
                  </select>
                  <label className="text-[var(--text-primary)] text-xs font-medium">Reason (required)</label>
                  <textarea
                    value={tierReason}
                    onChange={(e) => setTierReason(e.target.value)}
                    placeholder="e.g. Promotion, Payment failure compensation, Enterprise deal"
                    rows={3}
                    className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none resize-none"
                  />
                  <label className="text-[var(--text-primary)] text-xs font-medium">Trial end date (optional)</label>
                  <input
                    type="datetime-local"
                    value={trialEndsAt}
                    onChange={(e) => setTrialEndsAt(e.target.value)}
                    className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
                <div className="flex flex-row gap-3">
                  <button
                    onClick={() => setSetTierId(null)}
                    className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleSetTier()}
                    disabled={!tierReason.trim()}
                    className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
                  >
                    Set Tier
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
