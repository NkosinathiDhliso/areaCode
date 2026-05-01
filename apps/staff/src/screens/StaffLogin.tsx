import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { Spinner } from '@area-code/shared/components/Spinner'
import { useStaffAuthStore } from '../stores/staffAuthStore'

export function StaffLogin() {
  const { t } = useTranslation()
  const setAuth = useStaffAuthStore((s) => s.setAuth)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
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
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function handleSendOtp() {
    setLoading(true)
    setError(null)
    try {
      await api.post('/v1/auth/staff/login', { phone: normalizePhone(phone) })
      setStep('otp')
      startResendTimer()
    } catch (err: unknown) {
      const apiErr = err as { statusCode?: number; error?: string } | undefined
      if (apiErr?.statusCode === 404 || apiErr?.error === 'not_found') {
        setError(t('staff.login.notFound', 'No staff account found for this number.'))
        return
      }
      if (apiErr?.statusCode === 429) {
        setError(t('auth.login.rateLimited', 'Too many attempts. Please wait and try again.'))
        return
      }
      setError(t('staff.login.sendFailed', 'Failed to send OTP. Check your phone number.'))
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
        sessionId?: string
        staff: { id: string; name: string; businessId: string }
      }>('/v1/auth/staff/verify-otp', { phone: normalizePhone(phone), code: otp })
      setAuth(res.accessToken, res.refreshToken, res.staff.id, res.staff.businessId, res.staff.name, res.sessionId)
    } catch (err: unknown) {
      const apiErr = err as { statusCode?: number } | undefined
      if (apiErr?.statusCode === 429) {
        setError(t('auth.login.rateLimited', 'Too many attempts. Please wait and try again.'))
        return
      }
      setError(t('staff.login.otpFailed', 'Invalid or expired OTP.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-8 font-[Syne]">{t('staff.login.title')}</h1>

      {step === 'phone' ? (
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && phone && handleSendOtp()}
            placeholder={t('staff.login.phone')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            onClick={handleSendOtp}
            disabled={loading || !phone}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" className="border-white border-t-transparent" /> : t('staff.login.sendOtp')}
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
            placeholder={t('staff.login.otpPlaceholder')}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-center text-2xl tracking-[0.3em] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            autoFocus
          />
          <button
            onClick={handleVerifyOtp}
            disabled={loading || otp.length !== 6}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" className="border-white border-t-transparent" /> : t('staff.login.verifyOtp')}
          </button>
          <button
            onClick={handleSendOtp}
            disabled={loading || resendCooldown > 0}
            className="text-[var(--accent)] text-sm mt-1 disabled:text-[var(--text-muted)]"
          >
            {resendCooldown > 0
              ? t('auth.login.resendOtpCooldown', {
                  seconds: resendCooldown,
                  defaultValue: `Resend OTP (${resendCooldown}s)`,
                })
              : t('auth.login.resendOtp', 'Resend OTP')}
          </button>
          <button
            onClick={() => {
              setStep('phone')
              setOtp('')
              setError(null)
            }}
            className="text-[var(--text-secondary)] text-sm mt-1 flex items-center gap-1 justify-center"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {t('staff.login.changeNumber', 'Change number')}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-[var(--danger)] mt-3">{error}</p>}
    </div>
  )
}
