import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { AdminRole } from '@area-code/shared/types'
import { Spinner } from '@area-code/shared/components/Spinner'
import { useAdminAuthStore } from '../stores/adminAuthStore'

export function AdminLogin() {
  const { t } = useTranslation()
  const setAuth = useAdminAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        adminId: string
        role: AdminRole
      }>('/v1/auth/admin/login', { email, password })
      setAuth(res.accessToken, res.refreshToken, res.adminId, res.role)
    } catch {
      setError('Invalid credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5 py-10">
      {/* Brand + value prop */}
      <div className="w-full max-w-xs mb-6">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/20 ring-1 ring-[var(--border)]">
            <div className="h-2 w-2 rounded-full bg-[var(--accent-bright)] animate-pulse" />
          </div>
          <span className="font-[Syne] text-lg font-extrabold tracking-tight text-[var(--text-primary)]">
            Area Code <span className="text-[var(--text-secondary)] font-semibold">· Admin</span>
          </span>
        </div>
        <h1 className="text-[var(--text-primary)] font-bold text-2xl font-[Syne] leading-tight">
          {t('admin.login.title', 'Operate the Area Code platform')}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
          {t(
            'admin.login.subtitle',
            'Internal control panel. Moderate content, verify venues, and keep the network healthy.',
          )}
        </p>
        <ul className="mt-4 flex flex-col gap-2 text-xs text-[var(--text-secondary)]">
          {[
            t('admin.login.benefit1', 'Review reports and resolve user disputes'),
            t('admin.login.benefit2', 'Approve venue claims and verify CIPC'),
            t('admin.login.benefit3', 'Monitor platform health and operations'),
          ].map((b) => (
            <li key={b} className="flex items-start gap-2">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[var(--accent)] mt-0.5 shrink-0"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {t('admin.login.security', 'Authorized personnel only · all actions are audited')}
        </p>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('admin.login.email')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('admin.login.password')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          onClick={handleLogin}
          disabled={loading || !email || !password}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <Spinner size="sm" className="border-white border-t-transparent" /> : t('admin.login.submit')}
        </button>
      </div>

      {error && <p className="text-xs text-[var(--danger)] mt-3">{error}</p>}
    </div>
  )
}
