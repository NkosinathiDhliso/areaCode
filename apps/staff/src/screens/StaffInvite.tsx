import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'

interface StaffInviteProps {
  token: string
}

export function StaffInvite({ token }: StaffInviteProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  function normalizePhone(raw: string): string {
    const digits = raw.replace(/\s+/g, '')
    if (digits.startsWith('+')) return digits
    if (digits.startsWith('0')) return `+27${digits.slice(1)}`
    return `+${digits}`
  }

  async function handleAccept() {
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
    } catch {
      setStatus('error')
      setError('Invite is invalid or has expired.')
    }
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
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={handleAccept}
            disabled={!name.trim() || !phone.trim()}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 disabled:opacity-50"
          >
            Accept Invite
          </button>
          {error && <p className="text-xs text-[var(--danger)] mt-1">{error}</p>}
        </div>
      )}

      {status === 'loading' && (
        <p className="text-[var(--text-secondary)]">Setting up your account...</p>
      )}

      {status === 'success' && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-[var(--success)] font-medium">Account created.</p>
          <a
            href="/"
            className="text-[var(--accent)] underline text-sm"
          >
            Sign in
          </a>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-[var(--danger)] text-sm">{error}</p>
          <button
            onClick={() => { setStatus('idle'); setError(null) }}
            className="text-[var(--accent)] text-sm"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
