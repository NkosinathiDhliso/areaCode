import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { Spinner } from '@area-code/shared/components/Spinner'

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
  const [resendCooldown, setResendCooldown] = useState(0)

  // Auto-submit OTP when 6 digits entered
  useEffect(() => {
    if (otp.length === 6 && step === 'otp' && !loading) {
      handleVerifyOtp()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp])

  function normalizePhone(raw: string): string {
    const digits = raw.replace(/\s+/g, '')
    if (digits.startsWith('+')) return digits
    if (digits.startsWith('0')) return `+27${digits.slice(1)}`
    return `+${digits}`
  }

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
      await api.post('/v1/auth/business/login', { phone: normalizePhone(phone) })
      startResendTimer()
    } catch (err: unknown) {
      const apiErr = err as { statusCode?: number } | undefined
      if (apiErr?.statusCode === 429) {
        setError('Too many attempts. Please wait and try again.')
        return
      }
      setError('Failed to resend OTP.')
    } finally {
      setLoading(false)
    }
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
      startResendTimer()
    } catch (err: unknown) {
      const apiErr = err as { statusCode?: number } | undefined
      if (apiErr?.statusCode === 429 || apiErr?.statusCode === 403) {
        setError(t('biz.signup.rateLimited', 'Too many attempts. Please wait a few minutes and try again.'))
      } else {
        setError(t('biz.signup.error'))
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
            placeholder={`${t('biz.signup.regNumber')} (${t('common.optional', 'optional')})`}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={handleSignup}
            disabled={loading || !isDetailsValid}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 mt-1 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" className="border-white border-t-transparent" /> : t('biz.signup.submit')}
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
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-center text-2xl tracking-[0.3em] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            autoFocus
          />
          <button
            onClick={handleVerifyOtp}
            disabled={loading || otp.length !== 6}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" className="border-white border-t-transparent" /> : t('biz.login.verifyOtp')}
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
            onClick={() => { setStep('details'); setOtp(''); setError(null) }}
            className="text-[var(--text-secondary)] text-sm mt-1 flex items-center gap-1 justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            {t('biz.login.changeNumber', 'Change number')}
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
