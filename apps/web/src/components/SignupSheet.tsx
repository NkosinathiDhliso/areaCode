import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@area-code/shared/components/BottomSheet'

type Route = 'map' | 'ranks' | 'feed' | 'profile' | 'login' | 'signup' | 'landing'

interface SignupSheetProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (route: Route) => void
}

/**
 * Sign-up bottom sheet shown when an unauthenticated user attempts a gated
 * action (check-in, claim a get, etc.).
 *
 * Note: Earlier versions presented a "I'm a customer" / "I'm a business"
 * hard-fork here. We removed the business path because:
 *   1. Businesses live on a separate subdomain (business.areacode.co.za) and
 *      reach the portal via direct link from sales onboarding, not by
 *      discovering a toggle on a customer-facing surface.
 *   2. Surfacing a "I'm a business" button to consumers leaks that the
 *      consumer app and the business portal are part of one platform, which
 *      we don't want consumers to think about.
 *
 * The legacy hard-fork is still documented in
 * `.kiro/specs/area-code-app/requirements.md` Req 2.4 - that spec needs to be
 * updated alongside this change.
 */
export function SignupSheet({ isOpen, onClose, onNavigate }: SignupSheetProps) {
  const { t } = useTranslation()

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <p className="text-[var(--text-primary)] text-base font-medium mb-6 text-center">{t('auth.signupSheet.title')}</p>
      <div className="flex flex-col gap-3">
        <button
          onClick={() => {
            onClose()
            onNavigate('signup')
          }}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95"
        >
          {t('landing.signUp', 'Sign Up')}
        </button>
        <button
          onClick={() => {
            onClose()
            onNavigate('login')
          }}
          className="text-[var(--text-secondary)] text-sm py-2 transition-colors hover:text-[var(--accent)]"
        >
          {t('landing.hasAccount', 'Already have an account? Sign in')}
        </button>
      </div>
    </BottomSheet>
  )
}
