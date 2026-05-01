import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { SA_CITIES } from '@area-code/shared/constants/sa-cities'
import { toE164 } from '@area-code/shared/lib/formatters'
import { Spinner } from '@area-code/shared/components/Spinner'
import type { AppRoute } from '../types'

interface ConsumerSignupProps {
  onNavigate: (route: AppRoute) => void
}

export function ConsumerSignup({ onNavigate }: ConsumerSignupProps) {
  const { t } = useTranslation()
  const setAuth = useConsumerAuthStore((s) => s.setAuth)

  const [phone, setPhone] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [citySlug, setCitySlug] = useState('johannesburg')
  const [consentAnalytics, setConsentAnalytics] = useState(false)
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'form' | 'otp'>('form')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)

  // Auto-submit OTP when 6 digits entered (Issue #11)
  useEffect(() => {
    if (otp.length === 6 && step === 'otp' && !loading) {
      handleVerifyOtp()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp])

  function startResendTimer() {
    setResendCooldown(60)
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  async function handleResendOtp() {
    setLoading(true)
    setError(null)
    try {
      await api.post('/v1/auth/consumer/login', { phone: toE164(phone) })
      startResendTimer()
    } catch (err: unknown) {
      const apiErr = err as { statusCode?: number } | undefined
      if (apiErr?.statusCode === 429) {
        setError(t('auth.login.rateLimited', 'Too many attempts. Please wait and try again.'))
        return
      }
      setError(t('auth.signup.resendFailed', 'Failed to resend OTP.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSignup() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{ userId: string; message: string; existingAccount?: boolean }>(
        '/v1/auth/consumer/signup',
        {
          phone: toE164(phone),
          username,
          displayName,
          citySlug,
          consentAnalytics,
        },
      )
      if (res.existingAccount) {
        setError(null)
      }
      setStep('otp')
      startResendTimer()
    } catch (err) {
      const apiErr = err as { message?: string; statusCode?: number }
      if (apiErr.statusCode === 429) {
        setError(t('auth.login.rateLimited', 'Too many attempts. Please wait and try again.'))
      } else {
        setError(apiErr.message ?? t('auth.signup.failed'))
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string; refreshToken: string; sessionId?: string; user: { id: string }
      }>('/v1/auth/consumer/verify-otp', { phone: toE164(phone), code: otp })
      setAuth(res.accessToken, res.refreshToken, res.user.id, res.sessionId)
      onNavigate('map')
    } catch {
      setError(t('auth.login.otpFailed'))
    } finally {
      setLoading(false)
    }
  }

  if (step === 'otp') {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
        <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-8 font-[Syne]">
          {t('auth.signup.verifyTitle')}
        </h1>
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            placeholder={t('auth.login.otpPlaceholder')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-center text-2xl tracking-[0.3em] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            autoFocus
          />
          <button
            onClick={handleVerifyOtp}
            disabled={loading || otp.length !== 6}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" className="border-white border-t-transparent" /> : t('auth.login.verifyOtp')}
          </button>
          <button
            onClick={handleResendOtp}
            disabled={loading || resendCooldown > 0}
            className="text-[var(--accent)] text-sm mt-1 disabled:text-[var(--text-muted)]"
          >
            {resendCooldown > 0
              ? t('auth.login.resendOtpCooldown', { seconds: resendCooldown, defaultValue: `Resend OTP (${resendCooldown}s)` })
              : t('auth.login.resendOtp', 'Resend OTP')}
          </button>
          <button
            onClick={() => { setStep('form'); setOtp(''); setError(null) }}
            className="text-[var(--text-secondary)] text-sm mt-1 flex items-center gap-1 justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            {t('auth.login.changeNumber', 'Change number')}
          </button>
        </div>
        {error && <p className="text-xs text-[var(--danger)] mt-3">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-[var(--bg-base)] px-5 py-8 overflow-y-auto">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-6 font-[Syne]">
        {t('auth.signup.title')}
      </h1>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('auth.signup.phone')} className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none" />
        <input type="text" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder={t('auth.signup.username')} className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none" />
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t('auth.signup.displayName')} className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none" />
        <select value={citySlug} onChange={(e) => setCitySlug(e.target.value)} className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none appearance-none" aria-label={t('auth.signup.city')}>
          {SA_CITIES.map((city) => (
            <option key={city.slug} value={city.slug}>{city.name}</option>
          ))}
        </select>

        <label className="flex flex-row items-start gap-3 mt-2">
          <input type="checkbox" checked={consentAnalytics} onChange={(e) => setConsentAnalytics(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
          <span className="text-[var(--text-secondary)] text-xs">{t('auth.signup.consentAnalytics')}</span>
        </label>
        <p className="text-[var(--text-muted)] text-xs mt-2">
          {t('profile.privacyExplainer')}
        </p>

        <button onClick={handleSignup} disabled={loading || !phone || !username || !displayName} className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 mt-2 flex items-center justify-center gap-2">
          {loading ? <Spinner size="sm" className="border-white border-t-transparent" /> : t('auth.signup.submit')}
        </button>
      </div>

      {error && <p className="text-xs text-[var(--danger)] mt-3">{error}</p>}

      <button onClick={() => onNavigate('login')} className="mt-4 text-[var(--accent)] text-sm">
        {t('auth.signup.hasAccount')}
      </button>
    </div>
  )
}
