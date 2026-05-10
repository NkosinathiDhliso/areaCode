/**
 * Boost purchase confirmation with countdown timer.
 * Shows "Boost active!" state with remaining duration and marker preview.
 *
 * Requirements: 28.6
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from './Button'

export interface BoostConfirmationProps {
  /** ISO timestamp when boost expires */
  boostUntil: string
  /** Name of the boosted venue */
  nodeName: string
  /** Called when user taps "Done" */
  onDone: () => void
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00:00'
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function BoostConfirmation({ boostUntil, nodeName, onDone }: BoostConfirmationProps) {
  const { t } = useTranslation()
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(boostUntil).getTime() - Date.now()))

  useEffect(() => {
    const interval = setInterval(() => {
      const ms = Math.max(0, new Date(boostUntil).getTime() - Date.now())
      setRemaining(ms)
      if (ms <= 0) clearInterval(interval)
    }, 1000)
    return () => clearInterval(interval)
  }, [boostUntil])

  return (
    <div className="flex flex-col items-center gap-5 p-5">
      <div className="bg-[var(--color-boost-gold)] rounded-2xl p-8 flex flex-col items-center gap-4 w-full max-w-sm">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
          stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>

        <h2 className="text-white font-bold text-xl font-[Syne] text-center">
          {t('payment.boostActive', 'Boost Active!')}
        </h2>

        <p className="text-white text-sm opacity-90 text-center">{nodeName}</p>

        <div className="bg-white/20 rounded-xl px-5 py-3 mt-1">
          <span className="text-white font-mono text-2xl font-bold">
            {formatCountdown(remaining)}
          </span>
        </div>

        <p className="text-white text-xs opacity-75 text-center">
          {t('payment.boostRemaining', 'remaining')}
        </p>
      </div>

      {/* Marker preview */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full border-2 flex items-center justify-center"
          style={{
            borderColor: 'var(--color-boost-gold)',
            boxShadow: '0 0 12px var(--color-boost-glow)',
            background: 'var(--bg-surface)',
          }}
        >
          <div className="w-5 h-5 rounded-full bg-[var(--color-boost-gold)] animate-pulse" />
        </div>
        <span className="text-[var(--text-muted)] text-xs">
          {t('payment.boostMarkerPreview', 'Your venue now appears with a gold ring on the map')}
        </span>
      </div>

      <Button variant="primary" size="lg" onClick={onDone} className="w-full max-w-sm">
        {t('common.done', 'Done')}
      </Button>
    </div>
  )
}
