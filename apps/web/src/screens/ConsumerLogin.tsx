import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@area-code/shared/lib/api'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import type { AppRoute } from '../types'

interface ConsumerLoginProps {
  onNavigate: (route: AppRoute) => void
}

export function ConsumerLogin({ onNavigate }: ConsumerLoginProps) {
  const { t } = useTranslation()
  const setAuth = useConsumerAuthStore((s) => s.setAuth)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wrongDoor, setWrongDoor] = useState(false)

  /** Convert local SA number (06x, 07x, 08x) to E.164 (+27...) */
  function toE164(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.startsWith('0') && digits.length === 10) {
      return `+27${digits.slice(1)}`
    }
    if (digits.startsWith('27') && digits.length === 11) {
      return `+${digits}`
    }
    return raw.startsWith('+') ? raw : `+${digits}`
  }

  async function handleSendOtp() {
    setLoading(true)
    setError(null)
    setWrongDoor(false)
    const e164 = toE164(phone)
    try {
      await api.post('/v1/auth/consumer/login', { phone: e164 })
      setStep('otp')
    } catch {
      try {
        const typeRes = await api.get<{ accountType: string }>(
          `/v1/auth/account-type?phone=${encodeURIComponent(e164)}`,
        )
        if (typeRes.accountType === 'business') {
          setWrongDoor(true)
          return
        }
      } catch { /* non-critical fallback */ }
      setError(t('auth.login.sendFailed'))
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
      }>('/v1/auth/consumer/verify-otp', { phone: toE164(phone), code: otp })
      setAuth(res.accessToken, res.refreshToken, res.user.id)
      onNavigate('map')
    } catch {
      setError(t('auth.login.otpFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-8 font-[Syne]">
        {t('auth.login.title')}
      </h1>

      {step === 'phone' ? (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('auth.login.phone')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={handleSendOtp}
            disabled={loading || !phone}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 disabled:opacity-50"
          >
            {loading ? '...' : t('auth.login.sendOtp')}
          </button>
        </div>
      ) : (
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
      )}

      {wrongDoor && (
        <div className="mt-4 text-center">
          <p className="text-[var(--text-secondary)] text-sm">{t('auth.login.wrongDoor')}</p>
          <a href="/business/login" className="text-[var(--accent)] text-sm underline mt-1 inline-block">
            {t('auth.login.businessLogin')}
          </a>
        </div>
      )}

      {error && <p className="text-xs text-[var(--danger)] mt-3">{error}</p>}

      <button onClick={() => onNavigate('signup')} className="mt-6 text-[var(--accent)] text-sm">
        {t('auth.login.noAccount')}
      </button>
      <button onClick={() => onNavigate('map')} className="mt-3 text-[var(--text-muted)] text-xs">
        {t('auth.login.browseOnly')}
      </button>
    </div>
  )
}
