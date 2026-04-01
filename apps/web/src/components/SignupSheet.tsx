import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@area-code/shared/components/BottomSheet'

type Route = 'map' | 'gets' | 'ranks' | 'feed' | 'profile' | 'login' | 'signup' | 'landing'

interface SignupSheetProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (route: Route) => void
}

export function SignupSheet({ isOpen, onClose, onNavigate }: SignupSheetProps) {
  const { t } = useTranslation()

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <p className="text-[var(--text-primary)] text-base font-medium mb-6 text-center">
        {t('auth.signupSheet.title')}
      </p>
      <div className="flex flex-col gap-3">
        <button
          onClick={() => { onClose(); onNavigate('signup') }}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95"
        >
          {t('auth.landing.customer')}
        </button>
        <button
          onClick={() => { onClose(); window.location.href = '/signup/business' }}
          className="border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl py-3 px-5 bg-transparent transition-all duration-150"
        >
          {t('auth.landing.business')}
        </button>
      </div>
    </BottomSheet>
  )
}
