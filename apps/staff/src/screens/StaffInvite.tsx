import { Spinner } from '@area-code/shared/components/Spinner'
import { api } from '@area-code/shared/lib/api'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { startStaffGoogleOAuthWeb } from '../lib/startStaffGoogleOAuth'
import { useStaffAuthStore } from '../stores/staffAuthStore'

interface StaffInviteProps {
  token: string
}

export function StaffInvite({ token }: StaffInviteProps) {
  const { t } = useTranslation()
  const setAuth = useStaffAuthStore((s) => s.setAuth)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [metaLoading, setMetaLoading] = useState(true)
  const [meta, setMeta] = useState<{
    expired: boolean
    accepted: boolean
    hasGoogleOption: boolean
  } | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setMetaLoading(true)
      try {
        const res = await api.get<{
          expired: boolean
          accepted: boolean
          hasGoogleOption: boolean
        }>(`/v1/auth/staff-invite/meta?token=${encodeURIComponent(token)}`)
        if (!cancelled) setMeta(res)
      } catch {
        if (!cancelled) setMeta(null)
      } finally {
        if (!cancelled) setMetaLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleGoogleAccept() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (!meta || meta.expired || meta.accepted || !meta.hasGoogleOption) return
    setGoogleLoading(true)
    setError(null)
    try {
      sessionStorage.setItem('staff_oauth_invite_token', token)
      sessionStorage.setItem('staff_oauth_invite_name', name.trim())
      await startStaffGoogleOAuthWeb()
    } catch {
      setGoogleLoading(false)
      sessionStorage.removeItem('staff_oauth_invite_token')
      sessionStorage.removeItem('staff_oauth_invite_name')
      setError(t('auth.oauth.misconfigured', 'Sign-in is not configured. Try again later.'))
    }
  }

  async function handleEmailAccept() {
    if (!name.trim() || !email.trim() || password.length < 8) {
      setError('Name, email, and an 8+ character password required.')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        staff: { id: string; name: string; businessId: string }
      }>('/v1/staff-invite/email-accept', {
        token,
        name: name.trim(),
        email: email.trim(),
        password,
      })
      setAuth(res.accessToken, res.refreshToken, res.staff.id, res.staff.businessId, res.staff.name)
      setStatus('success')
    } catch (err: unknown) {
      setStatus('error')
      const apiErr = err as { message?: string }
      setError(apiErr.message ?? 'Invite is invalid or has expired.')
    }
  }

  if (metaLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5"
        style={{
          paddingTop: 'max(2rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        }}
      >
        <Spinner size="lg" />
      </div>
    )
  }

  if (!meta) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5"
        style={{
          paddingTop: 'max(2rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        }}
      >
        <p className="text-[var(--danger)] text-sm text-center">Invite not found.</p>
      </div>
    )
  }

  if (meta.accepted) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5"
        style={{
          paddingTop: 'max(2rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        }}
      >
        <p className="text-[var(--text-secondary)] text-sm text-center">This invite was already used.</p>
      </div>
    )
  }

  if (meta.expired) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5"
        style={{
          paddingTop: 'max(2rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        }}
      >
        <p className="text-[var(--danger)] text-sm text-center">This invite has expired.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-6 font-[Syne]">Join as Staff</h1>

      {status === 'idle' && (
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          {meta.hasGoogleOption && (
            <button
              type="button"
              onClick={() => void handleGoogleAccept()}
              disabled={googleLoading || !name.trim()}
              className="flex items-center justify-center gap-3 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] font-semibold rounded-xl py-4 text-base transition-all active:scale-95 disabled:opacity-50"
            >
              {googleLoading ? (
                <Spinner size="sm" className="border-[var(--accent)] border-t-transparent" />
              ) : (
                t('auth.login.continueGoogle', 'Continue with Google')
              )}
            </button>
          )}
          {meta.hasGoogleOption && <p className="text-[var(--text-muted)] text-xs text-center">or use email</p>}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={() => void handleEmailAccept()}
            disabled={!name.trim() || !email.trim() || password.length < 8}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base transition-all active:scale-95 disabled:opacity-50"
          >
            Accept Invite
          </button>
          {error && <p className="text-xs text-[var(--danger)] mt-1">{error}</p>}
        </div>
      )}

      {status === 'loading' && (
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-[var(--text-secondary)]">Setting up your account...</p>
        </div>
      )}

      {status === 'success' && (
        <div className="flex flex-col items-center gap-4 max-w-xs text-center">
          <p className="text-[var(--success)] font-medium text-lg">Account created</p>
          <p className="text-[var(--text-secondary)] text-sm">Your staff account is ready.</p>
          <a
            href="/"
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3 px-8 text-sm transition-all active:scale-95"
          >
            Go to Sign In
          </a>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-[var(--danger)] text-sm">{error}</p>
          <button
            type="button"
            onClick={() => {
              setStatus('idle')
              setError(null)
            }}
            className="text-[var(--accent)] text-sm"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
