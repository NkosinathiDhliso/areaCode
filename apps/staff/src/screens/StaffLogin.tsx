import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useStaffAuthStore } from '../stores/staffAuthStore'

export function StaffLogin() {
  const { t } = useTranslation()
  const setAuth = useStaffAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEmailLogin() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        sessionId?: string
        staff: { id: string; name: string; businessId: string }
      }>('/v1/auth/staff/email-login', { email, password })
      setAuth(res.accessToken, res.refreshToken, res.staff.id, res.staff.businessId, res.staff.name, res.sessionId)
    } catch (err: unknown) {
      const apiErr = err as { statusCode?: number } | undefined
      if (apiErr?.statusCode === 429) {
        setError(t('auth.login.rateLimited', 'Too many attempts. Please wait and try again.'))
        return
      }
      setError(t('staff.login.emailFailed', 'Invalid email or password.'))
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
            Area Code <span className="text-[var(--text-secondary)] font-semibold">· Staff</span>
          </span>
        </div>
        <h1 className="text-[var(--text-primary)] font-bold text-2xl font-[Syne] leading-tight">
          {t('staff.login.title', 'Check guests in. Verify rewards.')}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
          {t(
            'staff.login.subtitle',
            'The on-shift portal. Built for the floor — fast, focused, and only what you need.',
          )}
        </p>
        <ul className="mt-4 flex flex-col gap-2 text-xs text-[var(--text-secondary)]">
          {[
            t('staff.login.benefit1', 'Scan QR codes to confirm check-ins on the spot'),
            t('staff.login.benefit2', 'Validate Get redemptions in seconds'),
            t('staff.login.benefit3', 'No customer data — just the tools for your shift'),
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
      </div>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('staff.login.email', 'Email')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('staff.login.password', 'Password')}
          className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleEmailLogin()}
          disabled={loading || !email || !password}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Spinner size="sm" className="border-white border-t-transparent" />
          ) : (
            t('staff.login.submitEmail', 'Sign in')
          )}
        </button>
      </div>

      {error && <p className="text-xs text-[var(--danger)] mt-3">{error}</p>}
    </div>
  )
}
