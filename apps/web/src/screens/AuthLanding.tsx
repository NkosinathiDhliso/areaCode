import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'
import {
  Flame,
  Zap,
  Sparkles,
  CloudMoon,
  UtensilsCrossed,
  Coffee,
  Moon,
  ShoppingBag,
  Dumbbell,
  Palette,
  MapPin,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppRoute } from '../types'

interface AuthLandingProps {
  onNavigate: (route: AppRoute) => void
}

interface TrendingSpot {
  name: string
  area: string
  state: string
  checkIns: number
  nodeId?: string
  slug?: string
  category?: string
}

const FALLBACK_TRENDING: TrendingSpot[] = [
  { name: 'Maboneng Precinct', area: 'Johannesburg', state: 'active', checkIns: 34, category: 'arts' },
  { name: 'Umhlanga Promenade', area: 'Durban', state: 'buzzing', checkIns: 21, category: 'food' },
]

const STATE_CONFIG: Record<string, { Icon: LucideIcon; label: string }> = {
  popping: { Icon: Flame, label: 'Popping' },
  buzzing: { Icon: Zap, label: 'Buzzing' },
  active: { Icon: Sparkles, label: 'Active' },
  quiet: { Icon: CloudMoon, label: 'Quiet' },
  dormant: { Icon: CloudMoon, label: 'Dormant' },
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  food: UtensilsCrossed,
  coffee: Coffee,
  nightlife: Moon,
  retail: ShoppingBag,
  fitness: Dumbbell,
  arts: Palette,
}

export function AuthLanding({ onNavigate }: AuthLandingProps) {
  const { t } = useTranslation()

  const { data: trendingData } = useQuery({
    queryKey: ['trending'],
    queryFn: () => api.get<{ items: TrendingSpot[] }>('/v1/nodes/trending').catch(() => ({ items: FALLBACK_TRENDING })),
    staleTime: 60_000,
    retry: 1,
  })

  const trending = trendingData?.items ?? FALLBACK_TRENDING
  const hasLiveData = trendingData?.items !== undefined && trendingData.items !== FALLBACK_TRENDING

  const go = (route: AppRoute, path: string) => {
    window.history.pushState({ route }, '', path)
    onNavigate(route)
  }

  return (
    <div className="relative min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)] flex flex-col">
      {/* Glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-16 h-56 w-56 -translate-x-1/2 rounded-full bg-[var(--accent)]/15 blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-md flex flex-col flex-1 px-5 pt-12 pb-8">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-10">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/20 ring-1 ring-[var(--border)]">
            <div className="h-2 w-2 rounded-full bg-[var(--accent-bright)] animate-pulse" />
          </div>
          <span className="font-[Syne] text-xl font-extrabold tracking-tight">Area Code</span>
        </div>

        {/* Hero */}
        <h1 className="font-[Syne] text-3xl font-extrabold leading-tight tracking-[-0.02em]">
          {t('landing.heroLine1', "See what's alive")}
          <span className="block bg-[linear-gradient(90deg,var(--accent-bright),var(--accent))] bg-clip-text text-transparent">
            {t('landing.heroLine2', 'in your city.')}
          </span>
        </h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed max-w-xs">
          {t('landing.subtitle', 'Live map. Real check-ins. Rewards from local spots.')}
        </p>

        {/* CTAs */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => go('signup', '/signup')}
            className="flex-1 rounded-xl bg-[var(--accent)] py-3.5 text-sm font-semibold text-[var(--on-accent)] transition-all active:scale-95 hover:bg-[var(--accent-bright)]"
          >
            {t('landing.signUp', 'Sign Up')}
          </button>
          <button
            onClick={() => go('map', '/map')}
            className="flex-1 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] py-3.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
          >
            {t('landing.exploreMap', 'Explore Map')}
          </button>
        </div>

        {/*
          About section.

          Required by Google's OAuth brand-verification policy
          (https://support.google.com/cloud/answer/13464321):
            - "The homepage must accurately represent and identify your app or brand"
            - "The homepage must describe your app's functionality to its users.
               Your homepage can not be only a login page"

          Without this block, the page reads as a sign-in/sign-up surface and
          the brand-verification reviewer rejects with "home page does not
          explain the purpose of your app" and "home page is behind a login page".
          Do not remove unless replacing with equivalent prose.
        */}
        <section className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <h2 className="font-[Syne] text-base font-bold mb-2">About Area Code</h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Area Code is a real-time venue discovery and rewards app for South Africa. It shows a live map of cafes,
            restaurants, bars, and nightlife in Johannesburg, Cape Town, and Durban, with each venue&apos;s status
            (quiet, active, buzzing, or popping) updated as customers check in.
          </p>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mt-2">
            Customers check in when they arrive at a venue to earn rewards from that venue, climb local leaderboards,
            and discover places that match their taste. Sign in with Google or with email and password — no phone number
            required.
          </p>
        </section>

        {/* Trending now */}
        {trending.length > 0 && (
          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-medium tracking-widest text-[var(--text-muted)] uppercase">
                {t('landing.trendingNow', 'Trending Now')}
              </span>
              {hasLiveData && (
                <span className="rounded-full bg-[var(--success)]/20 px-2 py-0.5 text-[10px] font-semibold text-[var(--success)] animate-pulse">
                  {t('landing.live', 'Live')}
                </span>
              )}
            </div>
            {trending.slice(0, 5).map((spot) => {
              const CategoryIcon = CATEGORY_ICONS[spot.category ?? ''] ?? MapPin
              const stateConf = STATE_CONFIG[spot.state] ?? STATE_CONFIG.active!

              return (
                <button
                  key={spot.nodeId ?? spot.name}
                  onClick={() => go('map', '/map')}
                  className="w-full flex items-center justify-between rounded-xl bg-[var(--bg-raised)] px-3 py-2.5 mb-2 last:mb-0 text-left transition-all hover:border-[var(--accent)] border border-transparent group cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <CategoryIcon
                      size={16}
                      strokeWidth={1.5}
                      className="text-[var(--text-muted)] shrink-0"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="text-sm font-semibold group-hover:text-[var(--accent)]">{spot.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{spot.area}</p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-1.5">
                    <div>
                      <p className="text-xs font-medium flex items-center gap-1 justify-end">
                        <stateConf.Icon size={12} strokeWidth={2} className="text-[var(--accent)]" />
                        {stateConf.label}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {t('landing.checkIns', { count: spot.checkIns, defaultValue: `${spot.checkIns} check-ins` })}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Bottom links */}
        <div className="mt-auto pt-8 flex flex-col items-center gap-2">
          <button onClick={() => go('login', '/login')} className="text-sm text-[var(--accent)]">
            {t('landing.hasAccount', 'Already have an account? Sign in')}
          </button>
          <p className="text-[11px] text-[var(--text-muted)]">Cape Town · Johannesburg · Durban</p>
          {/*
            Legal footer.
            Required by the OAuth brand-verification policy: "You must add the
            link of your privacy policy to your homepage and this link should
            match the link you added on your OAuth consent screen configuration".
            The Privacy Policy URL configured in Google Cloud → Branding is
            https://www.areacode.co.za/legal/privacy. Keep these in sync.
          */}
          <nav aria-label="Legal" className="mt-3 flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
            <a
              href="https://www.areacode.co.za/legal/privacy"
              onClick={(e) => {
                e.preventDefault()
                go('legal-privacy', '/legal/privacy')
              }}
              className="hover:text-[var(--accent)] underline underline-offset-2"
            >
              Privacy Policy
            </a>
            <span aria-hidden="true">·</span>
            <a
              href="https://www.areacode.co.za/legal/terms"
              onClick={(e) => {
                e.preventDefault()
                go('legal-terms', '/legal/terms')
              }}
              className="hover:text-[var(--accent)] underline underline-offset-2"
            >
              Terms
            </a>
            <span aria-hidden="true">·</span>
            <a href="mailto:support@areacode.co.za" className="hover:text-[var(--accent)] underline underline-offset-2">
              Contact
            </a>
            <span aria-hidden="true">·</span>
            {/*
              Discoverable, low-key entry point to the business portal. Lives
              here (not in the sign-up sheet, not in the hero CTAs) so that a
              business owner who lands on the consumer site can still find
              their way to business.areacode.co.za, without surfacing the
              business path to ordinary customers. Uses a regular external
              link so the subdomain handles its own auth flow.
            */}
            <a
              href="https://business.areacode.co.za"
              className="hover:text-[var(--accent)] underline underline-offset-2"
            >
              For businesses →
            </a>
          </nav>
        </div>
      </div>
    </div>
  )
}
