import { useState, useRef, useEffect } from 'react'

import { api, type ApiError } from '../../shared/lib/api'
import { Box, Text } from '../../shared/components/primitives'

interface ValidationResult {
  success: boolean
  rewardTitle?: string
  redeemedAt?: string
  error?: 'invalid_code' | 'expired_code' | 'already_redeemed'
}

export function StaffValidator() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ValidationResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => setResult(null), 5000)
    return () => clearTimeout(timer)
  }, [result])

  async function handleValidate() {
    if (code.length !== 6 || loading) return
    setLoading(true)
    setResult(null)
    try {
      const res = await api.post<{ success: true; rewardTitle: string; redeemedAt: string }>(
        `/v1/rewards/${code}/redeem`,
        { code },
      )
      setResult({ success: true, rewardTitle: res.rewardTitle, redeemedAt: res.redeemedAt })
      setCode('')
    } catch (err) {
      const apiErr = err as ApiError
      const errorType = apiErr.error as ValidationResult['error'] ?? 'invalid_code'
      setResult({ success: false, error: errorType ?? 'invalid_code' })
      setCode('')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleValidate()
  }

  const resultMessage = result?.success
    ? `${result.rewardTitle} — redeemed`
    : result?.error === 'expired_code'
      ? 'Code has expired'
      : result?.error === 'already_redeemed'
        ? 'Already redeemed'
        : 'Invalid code'

  return (
    <Box className="flex flex-col items-center px-5 pt-8 gap-6">
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
        onKeyDown={handleKeyDown}
        placeholder="------"
        aria-label="Redemption code"
        className="w-full max-w-xs bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-6 text-center text-3xl tracking-[0.4em] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none font-[DM_Sans]"
      />

      <button
        onClick={handleValidate}
        disabled={loading || code.length !== 6}
        className="w-full max-w-xs bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 disabled:opacity-50"
      >
        {loading ? 'Validating...' : 'Validate'}
      </button>

      {result && (
        <Box
          role="alert"
          className={`w-full max-w-xs rounded-2xl p-4 text-center text-sm font-medium transition-all duration-300 ${
            result.success
              ? 'bg-[var(--success)] bg-opacity-15 text-[var(--success)]'
              : 'bg-[var(--danger)] bg-opacity-15 text-[var(--danger)]'
          }`}
        >
          <Text>{resultMessage}</Text>
        </Box>
      )}
    </Box>
  )
}
