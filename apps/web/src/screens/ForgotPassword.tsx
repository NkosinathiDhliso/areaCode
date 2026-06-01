import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import type { AppRoute } from '../types'

interface ForgotPasswordProps {
  onNavigate: (route: AppRoute) => void
}

type Phase = 'email' | 'code' | 'success'

export function ForgotPassword({ onNavigate }: ForgotPasswordProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRequestCode() {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post('/v1/auth/forgot-password', { email: email.trim() })
      setPhase('code')
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResetPassword() {
    if (!code.trim() || !newPassword.trim()) return
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post('/v1/auth/reset-password', { email: email.trim(), code: code.trim(), newPassword })
      setPhase('success')
    } catch (err: unknown) {
      const apiErr = err as { message?: string }
      setError(apiErr.message ?? 'Invalid or expired code. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="flex flex-col items-center justify-center min-h-dvh px-6 bg-[var(--bg-base)]"
      style={{
        paddingTop: 'max(2rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] text-center">
          {phase === 'success' ? t('auth.resetSuccess', 'Password reset') : t('auth.forgotPassword', 'Forgot password')}
        </h1>

        {phase === 'email' && (
          <>
            <p className="text-[var(--text-secondary)] text-sm text-center">
              {t('auth.forgotHint', "Enter your email and we'll send you a reset code.")}
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            />
            {error && <p className="text-[var(--danger)] text-xs">{error}</p>}
            <button
              onClick={() => void handleRequestCode()}
              disabled={loading || !email.trim()}
              className="w-full bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-50"
            >
              {loading ? '...' : t('auth.sendCode', 'Send reset code')}
            </button>
          </>
        )}

        {phase === 'code' && (
          <>
            <p className="text-[var(--text-secondary)] text-sm text-center">
              {t('auth.codeHint', 'Check your email for a 6-digit code.')}
            </p>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              inputMode="numeric"
              className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm text-center tracking-[0.3em] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 8 characters)"
              className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            />
            {error && <p className="text-[var(--danger)] text-xs">{error}</p>}
            <button
              onClick={() => void handleResetPassword()}
              disabled={loading || code.length !== 6 || newPassword.length < 8}
              className="w-full bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-50"
            >
              {loading ? '...' : t('auth.resetPassword', 'Reset password')}
            </button>
          </>
        )}

        {phase === 'success' && (
          <>
            <p className="text-[var(--text-secondary)] text-sm text-center">
              {t('auth.resetDone', 'Your password has been reset. You can now sign in.')}
            </p>
            <button
              onClick={() => onNavigate('login')}
              className="w-full bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm"
            >
              {t('auth.backToLogin', 'Back to sign in')}
            </button>
          </>
        )}

        {phase !== 'success' && (
          <button onClick={() => onNavigate('login')} className="text-[var(--text-muted)] text-sm text-center mt-2">
            {t('auth.backToLogin', 'Back to sign in')}
          </button>
        )}
      </div>
    </div>
  )
}
