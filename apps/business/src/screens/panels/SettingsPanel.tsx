import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { BusinessAccount, StaffAccount } from '@area-code/shared/types'

export function SettingsPanel() {
  const { t } = useTranslation()
  const [biz, setBiz] = useState<BusinessAccount | null>(null)
  const [staff, setStaff] = useState<StaffAccount[]>([])
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  useEffect(() => {
    async function fetch() {
      try {
        const [bizRes, staffRes] = await Promise.all([
          api.get<BusinessAccount>('/v1/business/me'),
          api.get<{ items: StaffAccount[] }>('/v1/business/staff'),
        ])
        setBiz(bizRes)
        setStaff(staffRes.items ?? [])
      } catch {
        // Fail silently
      }
    }
    fetch()
  }, [])

  async function handleGenerateQr() {
    try {
      const res = await api.get<{ url: string }>('/v1/business/nodes/current/qr')
      setQrUrl(res.url)
    } catch {
      // Fail silently
    }
  }

  async function handleRemoveStaff(staffId: string) {
    try {
      await api.delete(`/v1/business/staff/${staffId}`)
      setStaff((prev) => prev.filter((s) => s.id !== staffId))
    } catch {
      // Fail silently
    }
  }

  return (
    <div className="p-5 flex flex-col gap-6">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
        {t('biz.settings.title')}
      </h2>

      {/* Subscription */}
      {biz && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
          <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-2">
            {t('biz.settings.subscription')}
          </h3>
          <span className="text-[var(--text-primary)] font-medium capitalize">{biz.tier}</span>
          {biz.trialEndsAt && (
            <p className="text-[var(--warning)] text-xs mt-1">
              Trial ends {new Date(biz.trialEndsAt).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {/* Staff */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">
          {t('biz.settings.staff')}
        </h3>
        {staff.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No staff members</p>
        ) : (
          <div className="flex flex-col gap-2">
            {staff.map((s) => (
              <div key={s.id} className="flex flex-row items-center justify-between">
                <span className="text-[var(--text-primary)] text-sm">{s.name}</span>
                <button
                  onClick={() => handleRemoveStaff(s.id)}
                  className="text-[var(--danger)] text-xs"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* QR Code */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">
          {t('biz.settings.qr')}
        </h3>
        <button
          onClick={handleGenerateQr}
          className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-4 py-2 text-sm"
        >
          Generate QR Code
        </button>
        {qrUrl && (
          <p className="text-[var(--text-muted)] text-xs mt-2 break-all">{qrUrl}</p>
        )}
      </div>
    </div>
  )
}
