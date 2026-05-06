import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'

export function ConnectivityBanner() {
  const { t } = useTranslation()
  const state = useConnectivityStore((s) => s.state)
  const lastUpdated = useConnectivityStore((s) => s.lastUpdated)
  const [, setTick] = useState(0)

  // Re-render every 30s to keep relative time fresh (Issue #16)
  useEffect(() => {
    if (state === 'online') return
    const interval = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(interval)
  }, [state])

  if (state === 'online') return null

  const relativeTime = lastUpdated ? `${Math.round((Date.now() - new Date(lastUpdated).getTime()) / 60000)}m` : ''

  return (
    <div
      className={`flex items-center justify-center px-4 py-2 text-xs font-medium ${
        state === 'offline'
          ? 'bg-[var(--danger)] bg-opacity-20 text-[var(--danger)]'
          : 'bg-[var(--warning)] bg-opacity-20 text-[var(--warning)]'
      }`}
      role="alert"
    >
      {state === 'offline' ? t('offline.banner') : t('apiOnly.indicator')}
      {lastUpdated && state === 'offline' && (
        <span className="ml-2 opacity-70">{t('offline.lastUpdated', { time: relativeTime })}</span>
      )}
    </div>
  )
}
