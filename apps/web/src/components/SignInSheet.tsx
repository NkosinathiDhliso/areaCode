import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import { useTranslation } from 'react-i18next'

type Route = 'map' | 'ranks' | 'feed' | 'profile' | 'login' | 'landing'

interface SignInSheetProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (route: Route) => void
}

/**
 * Sign-in bottom sheet shown when an unauthenticated user attempts a gated
 * action (check-in, claim a get, etc.). It routes to the single consumer auth
 * screen (`ConsumerLogin`), which signs the user in or creates their account
 * when none exists - there is one auth entry, not a sign-in/sign-up fork.
 *
 * Note: Earlier versions presented a "I'm a customer" / "I'm a business"
 * hard-fork here. We removed the business path because:
 *   1. Businesses live on a separate subdomain (business.areacode.co.za) and
 *      reach the portal via direct link from sales onboarding, not by
 *      discovering a toggle on a customer-facing surface.
 *   2. Surfacing a "I'm a business" button to consumers leaks that the
 *      consumer app and the business portal are part of one platform, which
 *      we don't want consumers to think about.
 */
export function SignInSheet({ isOpen, onClose, onNavigate }: SignInSheetProps) {
  const { t } = useTranslation()

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <p className="text-[var(--text-primary)] text-base font-medium mb-6 text-center">
        {t('auth.signInSheet.title', 'Sign in to check in, earn gets, and climb the ranks')}
      </p>
      <div className="flex flex-col gap-3">
        <button
          onClick={() => {
            onClose()
            onNavigate('login')
          }}
          className="bg-[var(--accent-cta)] text-white font-semibold rounded-xl py-3.5 text-base transition-all duration-150 active:scale-95"
        >
          {t('auth.signInSheet.cta', 'Sign in to continue')}
        </button>
      </div>
    </BottomSheet>
  )
}
