import { useTranslation } from 'react-i18next'
import type { AppRoute } from '../types'

interface AuthLandingProps {
  onNavigate: (route: AppRoute) => void
}

export function AuthLanding({ onNavigate }: AuthLandingProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-3xl mb-2 font-[Syne]">
        {t('app.name')}
      </h1>
      <p className="text-[var(--text-secondary)] text-sm mb-12">
        {t('auth.landing.subtitle')}
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={() => onNavigate('signup')}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95"
        >
          {t('auth.landing.customer')}
        </button>
        <button
          onClick={() => { window.location.href = '/business/login' }}
          className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl py-3 px-5 bg-transparent transition-all duration-150"
        >
          {t('auth.landing.business')}
        </button>
      </div>

      <button onClick={() => onNavigate('login')} className="mt-6 text-[var(--accent)] text-sm">
        {t('auth.landing.hasAccount')}
      </button>
      <button onClick={() => onNavigate('map')} className="mt-4 text-[var(--text-muted)] text-xs">
        {t('auth.landing.browseOnly')}
      </button>
    </div>
  )
}
