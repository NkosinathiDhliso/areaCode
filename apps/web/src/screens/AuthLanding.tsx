import type { AppRoute } from '../types'

interface AuthLandingProps {
  onNavigate: (route: AppRoute) => void
}

const trending = [
  { name: 'Maboneng Precinct', area: 'Johannesburg', vibe: '🔥 Building', checkins: 34 },
  { name: 'Umhlanga Promenade', area: 'Durban', vibe: '📈 Trending', checkins: 21 },
]

export function AuthLanding({ onNavigate }: AuthLandingProps) {
  const go = (route: AppRoute, path: string) => {
    window.history.pushState({}, '', path)
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

        {/* Hero, short and direct */}
        <h1 className="font-[Syne] text-3xl font-extrabold leading-tight tracking-[-0.02em]">
          See what's alive
          <span className="block bg-[linear-gradient(90deg,var(--accent-bright),var(--accent))] bg-clip-text text-transparent">
            in your city.
          </span>
        </h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed max-w-xs">
          Live map. Real check-ins. Rewards from local spots.
        </p>

        {/* CTAs */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => go('signup', '/signup')}
            className="flex-1 rounded-xl bg-[var(--accent)] py-3.5 text-sm font-semibold text-[var(--on-accent)] transition-all active:scale-95 hover:bg-[var(--accent-bright)]"
          >
            Sign Up
          </button>
          <button
            onClick={() => go('map', '/map')}
            className="flex-1 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] py-3.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
          >
            Explore Map
          </button>
        </div>

        {/* Trending now, live mini dashboard */}
        <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium tracking-widest text-[var(--text-muted)] uppercase">Trending Now</span>
            <span className="rounded-full bg-[var(--success)]/20 px-2 py-0.5 text-[10px] font-semibold text-[var(--success)] animate-pulse">
              Live
            </span>
          </div>
          {trending.map((spot) => (
            <button
              key={spot.name}
              onClick={() => go('map', '/map')}
              className="w-full flex items-center justify-between rounded-xl bg-[var(--bg-raised)] px-3 py-2.5 mb-2 last:mb-0 text-left transition-all hover:border-[var(--accent)] border border-transparent group cursor-pointer"
            >
              <div>
                <p className="text-sm font-semibold group-hover:text-[var(--accent)]">{spot.name}</p>
                <p className="text-xs text-[var(--text-muted)]">{spot.area}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium">{spot.vibe}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{spot.checkins} check-ins</p>
              </div>
            </button>
          ))}
        </div>

        {/* Bottom links */}
        <div className="mt-auto pt-8 flex flex-col items-center gap-2">
          <button
            onClick={() => go('login', '/login')}
            className="text-sm text-[var(--accent)]"
          >
            Already have an account? Sign in
          </button>
          <p className="text-[11px] text-[var(--text-muted)]">Cape Town · Johannesburg · Durban</p>
        </div>
      </div>
    </div>
  )
}
