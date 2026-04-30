import { useTranslation } from 'react-i18next'

interface ErrorRetryProps {
  error: string
  onRetry: () => void
}

export function ErrorRetry({ error, onRetry }: ErrorRetryProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center gap-3 p-5">
      <p className="text-[var(--danger)] text-sm text-center">{error}</p>
      <button
        onClick={onRetry}
        className="bg-[var(--accent)] text-white font-semibold rounded-xl py-2.5 px-6 text-sm transition-all duration-150 active:scale-95"
      >
        {t('common.tryAgain', 'Try again')}
      </button>
    </div>
  )
}
