import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import { Spinner } from '@area-code/shared/components/Spinner'

import { startStaffGoogleOAuthWeb } from '../lib/startStaffGoogleOAuth'

interface StaffInviteProps {
  token: string
}

export function StaffInvite({ token }: StaffInviteProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
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

  function normalizePhone(raw: string): string {
    const digits = raw.replace(/\s+/g, '')
    if (digits.startsWith('+')) return digits
    if (digits.startsWith('0')) return `+27${digits.slice(1)}`
    return `+${digits}`
  }

  async function handleGoogleAccept() {
    if (!name.trim()) {
      setError('Please enter your name.')
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

  async function handlePhoneAccept() {
    if (!name.trim() || !phone.trim()) {
      setError('Please enter your name and phone number.')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      await api.post('/v1/staff-invite/accept', {
        token,
        name: name.trim(),
        phone: normalizePhone(phone),
      })
      setStatus('success')
    } catch (err: unknown) {
      setStatus('error')
      const apiErr = err as { message?: string }
      setError(apiErr.message ?? 'Invite is invalid or has expired.')
    }
  }

  if (metaLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
        <p className="text-[var(--danger)] text-sm text-center">Invite not found.</p>
      </div>
    )
  }

  if (meta.accepted) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
        <p className="text-[var(--text-secondary)] text-sm text-center">This invite was already used.</p>
      </div>
    )
  }

  if (meta.expired) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
        <p className="text-[var(--danger)] text-sm text-center">This invite has expired.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-6 font-[Syne]">
        Join as Staff
      </h1>

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
          {meta.hasGoogleOption && (
            <p className="text-[var(--text-muted)] text-xs text-center">or verify with phone</p>
          )}
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={() => void handlePhoneAccept()}
            disabled={!name.trim() || !phone.trim()}
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
          <p className="text-[var(--text-secondary)] text-sm">
            Your staff account is ready. Sign in with Google or your phone number to validate redemptions.
          </p>
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
