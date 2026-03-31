import { useTranslation } from 'react-i18next'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'

export function ConnectivityBanner() {
  const { t } = useTranslation()
  const { state, lastUpdated } = useConnectivityStore()

  if (state === 'online') return null

  const relativeTime = lastUpdated
    ? `${Math.round((Date.now() - new Date(lastUpdated).getTime()) / 60000)}m`
    : ''

  return (
    <div
      className={`flex items-center justify-center px-4 py-2 text-xs font-medium ${
        state === 'offline'
          ? 'bg-[var(--danger)] bg-opacity-20 text-[var(--danger)]'
          : 'bg-[var(--warning)] bg-opacity-20 text-[var(--warning)]'
      }`}
      role="alert"
    >
      {state === 'offline'
        ? t('offline.banner')
        : t('apiOnly.indicator')}
      {lastUpdated && state === 'offline' && (
        <span className="ml-2 opacity-70">
          {t('offline.lastUpdated', { time: relativeTime })}
        </span>
      )}
    </div>
  )
}
