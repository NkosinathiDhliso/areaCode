import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { SA_CITIES } from '@area-code/shared/constants/sa-cities'
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
  const [consentBroadcast, setConsentBroadcast] = useState(true)
  const [consentAnalytics, setConsentAnalytics] = useState(false)
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'form' | 'otp'>('form')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignup() {
    setLoading(true)
    setError(null)
    try {
      await api.post('/v1/auth/consumer/signup', {
        phone,
        username,
        displayName,
        citySlug,
        consentBroadcast,
        consentAnalytics,
      })
      setStep('otp')
    } catch (err) {
      const apiErr = err as { message?: string }
      setError(apiErr.message ?? t('auth.signup.failed'))
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string; refreshToken: string; user: { id: string }
      }>('/v1/auth/consumer/verify-otp', { phone, code: otp })
      setAuth(res.accessToken, res.refreshToken, res.user.id)
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
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-center text-2xl tracking-[0.3em] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none font-[DM_Sans]"
            autoFocus
          />
          <button
            onClick={handleVerifyOtp}
            disabled={loading || otp.length !== 6}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 disabled:opacity-50"
          >
            {loading ? '...' : t('auth.login.verifyOtp')}
          </button>
        </div>
        {error && <p className="text-xs text-[var(--danger)] mt-3">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5 overflow-y-auto">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-6 font-[Syne]">
        {t('auth.signup.title')}
      </h1>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('auth.signup.phone')} className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none" />
        <input type="text" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder={t('auth.signup.username')} className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none" />
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t('auth.signup.displayName')} className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none" />
        <select value={citySlug} onChange={(e) => setCitySlug(e.target.value)} className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none" aria-label={t('auth.signup.city')}>
          {SA_CITIES.map((city) => (
            <option key={city.slug} value={city.slug}>{city.name}</option>
          ))}
        </select>

        <label className="flex flex-row items-start gap-3 mt-2">
          <input type="checkbox" checked={consentAnalytics} onChange={(e) => setConsentAnalytics(e.target.checked)} className="mt-1" />
          <span className="text-[var(--text-secondary)] text-xs">{t('auth.signup.consentAnalytics')}</span>
        </label>
        <label className="flex flex-row items-start gap-3">
          <input type="checkbox" checked={consentBroadcast} onChange={(e) => setConsentBroadcast(e.target.checked)} className="mt-1" />
          <span className="text-[var(--text-secondary)] text-xs">{t('auth.signup.consentBroadcast')}</span>
        </label>

        <button onClick={handleSignup} disabled={loading || !phone || !username || !displayName} className="bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 mt-2">
          {loading ? '...' : t('auth.signup.submit')}
        </button>
      </div>

      {error && <p className="text-xs text-[var(--danger)] mt-3">{error}</p>}

      <button onClick={() => onNavigate('login')} className="mt-4 text-[var(--accent)] text-sm">
        {t('auth.signup.hasAccount')}
      </button>
    </div>
  )
}
