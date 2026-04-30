import type { AppRoute } from '../types'

interface AuthLandingProps {
  onNavigate: (route: AppRoute) => void
}

const featureCards = [
  {
    icon: '📍',
    title: 'Live Visual Map',
    body: 'Watch city hotspots breathe in real time as community activity grows and shifts around you.',
  },
  {
    icon: '🔥',
    title: 'Find The Pulse',
    body: 'Track what is trending tonight and move with momentum instead of guessing where to go.',
  },
  {
    icon: '🎁',
    title: 'Check In For Gets',
    body: 'Unlock rewards from local businesses by showing up and becoming part of your city story.',
  },
]

export function AuthLanding({ onNavigate }: AuthLandingProps) {
  const handleSignUp = () => {
    window.history.pushState({}, '', '/signup')
    onNavigate('signup')
  }

  const handleSignIn = () => {
    window.history.pushState({}, '', '/login')
    onNavigate('login')
  }

  const handleBrowse = () => {
    window.history.pushState({}, '', '/map')
    onNavigate('map')
  }

  const handleBusinessClick = () => {
    window.location.href = 'https://business.areacode.co.za'
  }

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute left-1/2 top-20 h-72 w-72 -translate-x-1/2 rounded-full bg-[var(--accent)]/20 blur-3xl" />
        <div className="absolute bottom-8 right-0 h-64 w-64 rounded-full bg-[var(--info)]/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-col px-5 pb-10 pt-6 sm:px-8 lg:px-10">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/20 ring-1 ring-[var(--border-strong)]">
              <div className="h-2.5 w-2.5 rounded-full bg-[var(--accent-bright)] animate-pulse" />
            </div>
            <h1 className="font-[Syne] text-2xl font-extrabold tracking-[-0.02em]">Area Code</h1>
          </div>
          <button
            onClick={handleSignIn}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--accent)]"
          >
            Sign In
          </button>
        </header>

        <main className="mt-10 flex flex-col gap-14 lg:mt-14 lg:gap-16">
          {/* Hero */}
          <section className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <p className="mb-4 inline-flex rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-1 text-xs font-medium tracking-[0.08em] text-[var(--accent)] uppercase">
                Now Live in South Africa
              </p>
              <h2 className="font-[Syne] text-4xl font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-5xl lg:text-6xl">
                The city is alive.
                <span className="mt-2 block bg-[linear-gradient(90deg,var(--accent-bright),var(--accent))] bg-clip-text text-transparent">
                  Find the pulse.
                </span>
              </h2>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
                Area Code is a map-first social discovery app for urban South Africans. Follow live energy, check in with your crew, and earn rewards from places that matter.
              </p>

              {/* CTA buttons */}
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  onClick={handleSignUp}
                  className="rounded-xl bg-[var(--accent)] px-6 py-3.5 text-base font-semibold text-[var(--on-accent)] transition-all duration-150 active:scale-95 hover:bg-[var(--accent-bright)] shadow-lg shadow-[var(--accent)]/20"
                >
                  Get Started
                </button>
                <button
                  onClick={handleBrowse}
                  className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] px-6 py-3.5 text-base font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-raised)]"
                >
                  Explore the Map
                </button>
              </div>

              <p className="mt-4 text-xs text-[var(--text-muted)]">
                Free to use. Available in Cape Town, Johannesburg, and Durban.
              </p>
            </div>

            {/* Live feed preview */}
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-md)]">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-medium tracking-[0.08em] text-[var(--text-muted)] uppercase">Live City Feed</span>
                <span className="rounded-full bg-[var(--success)]/20 px-2 py-0.5 text-[11px] font-semibold text-[var(--success)] animate-pulse">
                  Live
                </span>
              </div>
              <div className="space-y-3">
                <button
                  onClick={handleBrowse}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] p-3 text-left transition-all hover:border-[var(--accent)] hover:bg-[var(--bg-raised)]/80 cursor-pointer group"
                >
                  <p className="text-sm font-semibold group-hover:text-[var(--accent)]">Maboneng is building tonight</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Pulse spikes as check-ins climb near Fox Street.</p>
                </button>
                <button
                  onClick={handleBrowse}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] p-3 text-left transition-all hover:border-[var(--accent)] hover:bg-[var(--bg-raised)]/80 cursor-pointer group"
                >
                  <p className="text-sm font-semibold group-hover:text-[var(--accent)]">New get activated in Braam</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Limited slots at a rooftop node right now.</p>
                </button>
                <button
                  onClick={handleBrowse}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] p-3 text-left transition-all hover:border-[var(--accent)] hover:bg-[var(--bg-raised)]/80 cursor-pointer group"
                >
                  <p className="text-sm font-semibold group-hover:text-[var(--accent)]">Durban beachfront trending</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Momentum up 42 percent in the last hour.</p>
                </button>
              </div>
            </div>
          </section>

          {/* Feature cards */}
          <section className="grid gap-4 md:grid-cols-3">
            {featureCards.map((card) => (
              <button
                key={card.title}
                onClick={handleBrowse}
                className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 text-left transition-all hover:border-[var(--accent)] hover:shadow-[var(--shadow-md)] hover:bg-[var(--bg-raised)] cursor-pointer group"
              >
                <span className="text-2xl">{card.icon}</span>
                <h3 className="mt-2 font-[Syne] text-xl font-bold tracking-[-0.01em] group-hover:text-[var(--accent)]">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{card.body}</p>
              </button>
            ))}
          </section>

          {/* Business CTA */}
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 text-center sm:p-8">
            <h3 className="font-[Syne] text-xl font-bold">Own a business?</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              List your venue, create rewards, and connect with customers who are already nearby.
            </p>
            <button
              onClick={handleBusinessClick}
              className="mt-4 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-raised)] px-5 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
            >
              Business Dashboard
            </button>
          </section>

          {/* Footer */}
          <footer className="flex flex-col items-center gap-2 pt-4 pb-2 text-xs text-[var(--text-muted)]">
            <p>Built in South Africa for South African cities.</p>
            <p>&copy; {new Date().getFullYear()} Area Code</p>
          </footer>
        </main>
      </div>
    </div>
  )
}
