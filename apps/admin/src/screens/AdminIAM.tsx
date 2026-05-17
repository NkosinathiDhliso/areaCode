import { useEffect, useState } from 'react'
import { api } from '@area-code/shared/lib/api'
import { Spinner } from '@area-code/shared/components/Spinner'

const ROLES = ['super_admin', 'support_agent', 'content_moderator'] as const
type AdminRole = (typeof ROLES)[number]

interface AdminUser {
  sub: string
  email: string
  role: string
  enabled: boolean
}

export function AdminIAM() {
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [createRole, setCreateRole] = useState<AdminRole>('support_agent')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [changingRoleId, setChangingRoleId] = useState<string | null>(null)
  const [newRole, setNewRole] = useState<AdminRole>('support_agent')
  const [roleLoading, setRoleLoading] = useState(false)
  const [roleError, setRoleError] = useState<string | null>(null)

  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)
  const [deactivateLoading, setDeactivateLoading] = useState(false)
  const [deactivateError, setDeactivateError] = useState<string | null>(null)

  async function loadAdmins() {
    setLoadingList(true)
    setListError(null)
    try {
      const res = await api.get<{ admins: AdminUser[] }>('/v1/admin/iam/admins')
      setAdmins(res.admins)
    } catch {
      setListError('Failed to load admin accounts.')
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => {
    void loadAdmins()
  }, [])

  async function handleCreate() {
    if (!createEmail.trim() || !createPassword.trim()) return
    setCreateLoading(true)
    setCreateError(null)
    try {
      await api.post('/v1/admin/iam/admins', {
        email: createEmail.trim().toLowerCase(),
        tempPassword: createPassword.trim(),
        role: createRole,
      })
      setCreateEmail('')
      setCreatePassword('')
      setCreateRole('support_agent')
      void loadAdmins()
    } catch (err: unknown) {
      const e = err as { message?: string }
      setCreateError(e.message ?? 'Failed to create admin')
    } finally {
      setCreateLoading(false)
    }
  }

  async function handleChangeRole() {
    if (!changingRoleId) return
    setRoleLoading(true)
    setRoleError(null)
    try {
      await api.patch(`/v1/admin/iam/admins/${changingRoleId}/role`, { role: newRole })
      setChangingRoleId(null)
      void loadAdmins()
    } catch {
      setRoleError('Failed to update role. Please try again.')
    } finally {
      setRoleLoading(false)
    }
  }

  async function handleDeactivate() {
    if (!confirmDeactivateId) return
    setDeactivateLoading(true)
    setDeactivateError(null)
    try {
      await api.post(`/v1/admin/iam/admins/${confirmDeactivateId}/deactivate`)
      setConfirmDeactivateId(null)
      void loadAdmins()
    } catch {
      setDeactivateError('Failed to deactivate admin. Please try again.')
    } finally {
      setDeactivateLoading(false)
    }
  }

  return (
    <div className="p-5 flex flex-col gap-6">
      <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">Admin IAM</h2>

      {/* Create new admin */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Create Admin Account</h3>
        <div className="flex flex-col gap-3">
          <input
            type="email"
            value={createEmail}
            onChange={(e) => setCreateEmail(e.target.value)}
            placeholder="Email address"
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="password"
            value={createPassword}
            onChange={(e) => setCreatePassword(e.target.value)}
            placeholder="Temporary password"
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <select
            value={createRole}
            onChange={(e) => setCreateRole(e.target.value as AdminRole)}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          {createError && <p className="text-[var(--danger)] text-xs">{createError}</p>}
          <button
            onClick={() => void handleCreate()}
            disabled={createLoading || !createEmail.trim() || !createPassword.trim()}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {createLoading ? <Spinner size="sm" className="border-white border-t-transparent" /> : 'Create Admin'}
          </button>
        </div>
      </div>

      {/* Admin list */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h3 className="text-[var(--text-secondary)] text-xs uppercase tracking-wider mb-3">Admin Accounts</h3>
        {listError && <p className="text-[var(--danger)] text-sm mb-3">{listError}</p>}
        {loadingList ? (
          <div className="flex items-center justify-center py-4">
            <Spinner size="md" />
          </div>
        ) : admins.length === 0 && !listError ? (
          <p className="text-[var(--text-muted)] text-sm">No admin accounts found.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {admins.map((a) => (
              <div
                key={a.sub}
                className="flex flex-row items-center justify-between bg-[var(--bg-raised)] rounded-xl px-3 py-2.5"
              >
                <div className="flex flex-col min-w-0 mr-3">
                  <span className="text-[var(--text-primary)] text-sm truncate">{a.email}</span>
                  <span className="text-[var(--text-muted)] text-xs capitalize">{a.role?.replace(/_/g, ' ')}</span>
                  {!a.enabled && <span className="text-[var(--danger)] text-xs">Deactivated</span>}
                </div>
                {a.enabled && (
                  <div className="flex flex-row gap-2 flex-shrink-0">
                    <button
                      onClick={() => {
                        setChangingRoleId(a.sub)
                        setNewRole(a.role as AdminRole)
                      }}
                      className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-lg px-2.5 py-1 text-xs"
                    >
                      Role
                    </button>
                    <button
                      onClick={() => setConfirmDeactivateId(a.sub)}
                      className="border border-[var(--danger)] text-[var(--danger)] rounded-lg px-2.5 py-1 text-xs"
                    >
                      Deactivate
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Change role dialog */}
      {changingRoleId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-4 font-[Syne]">Change Role</h3>
            {roleError && <p className="text-[var(--danger)] text-xs mb-3">{roleError}</p>}
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as AdminRole)}
              className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm mb-4 focus:border-[var(--accent)] focus:outline-none"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setChangingRoleId(null)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleChangeRole()}
                disabled={roleLoading}
                className="flex-1 bg-[var(--accent)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {roleLoading ? '...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate confirmation */}
      {confirmDeactivateId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">Deactivate Admin?</h3>
            {deactivateError && <p className="text-[var(--danger)] text-xs mb-3">{deactivateError}</p>}
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              This will immediately revoke all sessions. The account can be re-enabled manually in AWS Cognito.
            </p>
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setConfirmDeactivateId(null)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDeactivate()}
                disabled={deactivateLoading}
                className="flex-1 bg-[var(--danger)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {deactivateLoading ? '...' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
