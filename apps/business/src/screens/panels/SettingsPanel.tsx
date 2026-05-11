import { api } from '@area-code/shared/lib/api'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import type { BusinessAccount, StaffAccount } from '@area-code/shared/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeEditorPanel } from './NodeEditorPanel'

interface StaffInvite {
  id: string
  inviteToken: string
  invitedPhone: string | null
  invitedEmail: string | null
  accepted: boolean
  expiresAt: string
  createdAt: string
}

function getInviteUrl(token: string): string {
  const base = window.location.origin.replace('business.', 'staff.')
  return `${base}/staff-invite/${token}`
}

export function SettingsPanel() {
  const { t } = useTranslation()
  const setPanel = useBusinessStore((s) => s.setPanel)
  const [biz, setBiz] = useState<BusinessAccount | null>(null)
  const [staff, setStaff] = useState<StaffAccount[]>([])
  const [invites, setInvites] = useState<StaffInvite[]>([])
  const [qrCheckinUrl, setQrCheckinUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteResult, setInviteResult] = useState<{ token: string } | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRemoveStaffId, setConfirmRemoveStaffId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [bizRes, staffRes, inviteRes] = await Promise.all([
          api.get<BusinessAccount>('/v1/business/me'),
          api.get<{ items: StaffAccount[] }>('/v1/business/staff'),
          api.get<{ items: StaffInvite[] }>('/v1/business/staff/invites'),
        ])
        setBiz(bizRes)
        setStaff(staffRes.items ?? (Array.isArray(staffRes) ? staffRes : []))
        setInvites(inviteRes.items ?? [])
      } catch {
        setLoadError(true)
      }
    }
    void load()
  }, [])

  async function handleInviteStaff() {
    if (!inviteEmail.trim()) return
    setInviteLoading(true)
    setInviteError(null)
    setInviteResult(null)
    setCopied(false)
    try {
      const res = await api.post<StaffInvite>('/v1/business/staff/invite', {
        email: inviteEmail.trim().toLowerCase(),
      })
      setInviteResult({ token: res.inviteToken })
      setInviteEmail('')
      // Refresh invites list
      const inviteRes = await api.get<{ items: StaffInvite[] }>('/v1/business/staff/invites')
      setInvites(inviteRes.items ?? [])
    } catch (err: unknown) {
      const apiErr = err as { message?: string }
      setInviteError(apiErr.message ?? 'Failed to send invite')
    } finally {
      setInviteLoading(false)
    }
  }

  async function handleCopyLink(token: string) {
    const url = getInviteUrl(token)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked — select the link in the URL bar so the user can copy manually
      setInviteError(`Copy failed. Here is the link: ${url}`)
    }
  }

  async function handleShareLink(token: string) {
    const url = getInviteUrl(token)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Staff Invite', text: 'Join our team on Area Code', url })
      } catch {
        /* user cancelled */
      }
    } else {
      handleCopyLink(token)
    }
  }

  async function handleGenerateQr() {
    setQrError(null)
    try {
      const res = await api.get<{ url: string }>('/v1/business/nodes/current/qr')
      setQrCheckinUrl(res.url)
    } catch (err: unknown) {
      const e = err as { message?: string; status?: number }
      if (e.status === 404 || (e.message ?? '').toLowerCase().includes('no nodes')) {
        setQrError('No node found. Create a node in the Node tab first.')
      } else {
        setQrError('Failed to generate QR. Please try again.')
      }
    }
  }

  async function handleRemoveStaff(staffId: string) {
    setConfirmRemoveStaffId(staffId)
  }

  function confirmRemoveStaff() {
    if (!confirmRemoveStaffId) return
    const staffId = confirmRemoveStaffId
    setConfirmRemoveStaffId(null)
    void (async () => {
      try {
        await api.delete(`/v1/business/staff/${staffId}`)
        setStaff((prev) => prev.filter((s) => s.id !== staffId))
      } catch {
        /* Fail silently */
      }
    })()
  }

  const pendingInvites = invites.filter((i) => !i.accepted && new Date(i.expiresAt) > new Date())

  return (
    <div className="p-5 flex flex-col gap-6">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('biz.settings.title')}</h2>

      {/* Venue Management */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl">
        <NodeEditorPanel />
      </div>

      {loadError && (
        <div className="bg-[var(--danger)]/10 border border-[var(--danger)] rounded-xl p-3 text-[var(--danger)] text-sm">
          Failed to load settings. Please refresh and try again.
        </div>
      )}

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
          <button onClick={() => setPanel('plans')} className="text-[var(--accent)] text-xs mt-2">
            {t('biz.plans.changePlan')}
          </button>
        </div>
      )}

      {/* Staff Management */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Staff Members</h3>

        {/* Invite form */}
        <div className="flex flex-row gap-2 mb-4">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="Staff email address"
            className="flex-1 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2.5 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={handleInviteStaff}
            disabled={inviteLoading || !inviteEmail.trim()}
            className="bg-[var(--accent)] text-white font-medium rounded-xl px-4 py-2.5 text-sm transition-all active:scale-95 disabled:opacity-50 whitespace-nowrap"
          >
            {inviteLoading ? '...' : 'Invite'}
          </button>
        </div>

        {inviteError && <p className="text-[var(--danger)] text-xs mb-3">{inviteError}</p>}

        {/* Just-created invite link */}
        {inviteResult && (
          <div className="bg-[var(--bg-raised)] border border-[var(--accent)] rounded-xl p-3 mb-4">
            <p className="text-[var(--text-primary)] text-xs font-medium mb-2">
              Invite created. Share this link with your staff member:
            </p>
            <p className="text-[var(--accent)] text-xs break-all mb-2">{getInviteUrl(inviteResult.token)}</p>
            <div className="flex flex-row gap-2">
              <button
                onClick={() => handleCopyLink(inviteResult.token)}
                className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-lg px-3 py-1.5 text-xs"
              >
                {copied ? 'Copied' : 'Copy Link'}
              </button>
              <button
                onClick={() => handleShareLink(inviteResult.token)}
                className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-lg px-3 py-1.5 text-xs"
              >
                Share via WhatsApp
              </button>
            </div>
          </div>
        )}

        {/* Pending invites */}
        {pendingInvites.length > 0 && (
          <div className="mb-4">
            <p className="text-[var(--text-muted)] text-xs mb-2">Pending invites</p>
            <div className="flex flex-col gap-2">
              {pendingInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-row items-center justify-between bg-[var(--bg-raised)] rounded-xl px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-[var(--text-primary)] text-sm">{inv.invitedEmail ?? 'No email'}</span>
                    <span className="text-[var(--text-muted)] text-xs">
                      Expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button onClick={() => handleCopyLink(inv.inviteToken)} className="text-[var(--accent)] text-xs">
                    Copy Link
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active staff */}
        {staff.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No staff members yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {staff.map((s) => (
              <div
                key={s.id}
                className="flex flex-row items-center justify-between bg-[var(--bg-raised)] rounded-xl px-3 py-2"
              >
                <div className="flex flex-col">
                  <span className="text-[var(--text-primary)] text-sm">
                    {s.name?.trim() || s.email || s.phone || 'Pending invite'}
                  </span>
                  {s.email && s.name?.trim() && <span className="text-[var(--text-muted)] text-xs">{s.email}</span>}
                  {s.phone && <span className="text-[var(--text-muted)] text-xs">{s.phone}</span>}
                  {!s.cognitoSub && <span className="text-[var(--warning)] text-xs">Invite pending acceptance</span>}
                </div>
                <button onClick={() => handleRemoveStaff(s.id)} className="text-[var(--danger)] text-xs">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* QR Code */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">{t('biz.settings.qr')}</h3>
        <button
          onClick={() => void handleGenerateQr()}
          className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl px-4 py-2 text-sm"
        >
          Generate QR Code
        </button>
        {qrError && <p className="text-[var(--warning)] text-xs mt-2">{qrError}</p>}
        {qrCheckinUrl && (
          <div className="mt-3 flex flex-col items-center gap-2">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrCheckinUrl)}`}
              alt="QR Code for check-in"
              className="w-48 h-48 rounded-xl bg-white p-2"
            />
            <p className="text-[var(--text-muted)] text-xs text-center">
              Print or screenshot this QR code for your venue
            </p>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(qrCheckinUrl)
              }}
              className="text-[var(--accent)] text-xs"
            >
              Copy check-in URL
            </button>
          </div>
        )}
      </div>

      {/* Staff removal confirmation dialog */}
      {confirmRemoveStaffId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">Remove staff member?</h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              They will no longer be able to validate redemptions. You can re-invite them later.
            </p>
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setConfirmRemoveStaffId(null)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveStaff}
                className="flex-1 bg-[var(--danger)] text-white rounded-xl py-2.5 text-sm font-medium"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
