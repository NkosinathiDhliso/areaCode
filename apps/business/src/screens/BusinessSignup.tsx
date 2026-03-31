import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'

interface BusinessSignupProps {
  onSwitchToLogin: () => void
}

export function BusinessSignup({ onSwitchToLogin }: BusinessSignupProps) {
  const { t } = useTranslation()
  const setAuth = useBusinessAuthStore((s) => s.setAuth)
  const [step, setStep] = useState<'details' | 'otp'>('details')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function normalizePhone(raw: string): string {
    const digits = raw.replace(/\s+/g, '')
    if (digits.startsWith('+')) return digits
    if (digits.startsWith('0')) return `+27${digits.slice(1)}`
    return `+${digits}`
  }

  async function handleSignup() {
    setLoading(true)
    setError(null)
    try {
      await api.post('/v1/auth/business/signup', {
        email,
        phone: normalizePhone(phone),
        businessName,
        ...(registrationNumber ? { registrationNumber } : {}),
      })
      setStep('otp')
    } catch {
      setError(t('biz.signup.error'))
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post<{
        accessToken: string
        refreshToken: string
        businessId: string
      }>('/v1/auth/business/verify-otp', { phone: normalizePhone(phone), code: otp })
      setAuth(res.accessToken, res.refreshToken, res.businessId)
    } catch {
      setError(t('biz.signup.otpError'))
    } finally {
      setLoading(false)
    }
  }

  const isDetailsValid = email.includes('@') && phone.length >= 9 && businessName.length >= 2

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-2 font-[Syne]">
        {t('biz.signup.title')}
      </h1>
      <p className="text-[var(--text-secondary)] text-sm mb-8 text-center max-w-xs">
        {t('biz.signup.subtitle')}
      </p>

      {step === 'details' ? (
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder={t('biz.signup.businessName')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('biz.signup.email')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('biz.signup.phone')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <input
            type="text"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            placeholder={t('biz.signup.regNumber')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={handleSignup}
            disabled={loading || !isDetailsValid}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 mt-1"
          >
            {loading ? '...' : t('biz.signup.submit')}
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
            placeholder="------"
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-center text-2xl tracking-[0.3em] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            autoFocus
          />
          <button
            onClick={handleVerifyOtp}
            disabled={loading || otp.length !== 6}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 disabled:opacity-50"
          >
            {loading ? '...' : t('biz.login.verifyOtp')}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-[var(--danger)] mt-3">{error}</p>}

      <button
        onClick={onSwitchToLogin}
        className="text-[var(--text-secondary)] text-sm mt-6"
      >
        {t('biz.signup.hasAccount')}
      </button>
    </div>
  )
}
