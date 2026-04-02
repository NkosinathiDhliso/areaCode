import { useState, type FormEvent } from 'react'
import type { AppRoute } from '../types'

interface AuthLandingProps {
  onNavigate: (route: AppRoute) => void
}

const featureCards = [
  {
    title: 'Live Visual Map',
    body: 'Watch city hotspots breathe in real time as community activity grows and shifts around you.',
  },
  {
    title: 'Find The Pulse',
    body: 'Track what is trending tonight and move with momentum instead of guessing where to go.',
  },
  {
    title: 'Check In For Gets',
    body: 'Unlock rewards from local businesses by showing up and becoming part of your city story.',
  },
]

export function AuthLanding({ onNavigate }: AuthLandingProps) {
  const [email, setEmail] = useState('')
  const [isSubmitted, setIsSubmitted] = useState(false)

  const handleWaitlistSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim()) return
    setIsSubmitted(true)
  }

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute left-1/2 top-20 h-72 w-72 -translate-x-1/2 rounded-full bg-[var(--accent)]/20 blur-3xl" />
        <div className="absolute bottom-8 right-0 h-64 w-64 rounded-full bg-[var(--info)]/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-col px-5 pb-10 pt-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/20 ring-1 ring-[var(--border-strong)]">
              <div className="h-2.5 w-2.5 rounded-full bg-[var(--accent-bright)] animate-pulse" />
            </div>
            <h1 className="font-[Syne] text-2xl font-extrabold tracking-[-0.02em]">Area Code</h1>
          </div>
          <button
            onClick={() => onNavigate('login')}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Sign In
          </button>
        </header>

        <main className="mt-10 flex flex-col gap-14 lg:mt-14 lg:gap-16">
          <section className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <p className="mb-4 inline-flex rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium tracking-[0.08em] text-[var(--text-secondary)] uppercase">
                South Africa Beta
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

              <form onSubmit={handleWaitlistSubmit} className="mt-7 flex flex-col gap-3 sm:flex-row">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter your email"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none sm:max-w-sm"
                  aria-label="Email address"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-[var(--on-accent)] transition-all duration-150 active:scale-95"
                >
                  Join Waitlist
                </button>
              </form>
              <p className="mt-3 text-xs text-[var(--text-muted)]">
                {isSubmitted ? 'Thanks, we will reach out with early access updates.' : 'Built in South Africa for South African cities.'}
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <button
                  onClick={() => onNavigate('signup')}
                  className="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--on-accent)] transition-all duration-150 active:scale-95"
                >
                  I am a customer
                </button>
                <button
                  onClick={() => { window.location.href = '/business/login' }}
                  className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
                >
                  I am a business
                </button>
                <button
                  onClick={() => onNavigate('map')}
                  className="rounded-xl px-5 py-3 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Browse map first
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-md)]">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-medium tracking-[0.08em] text-[var(--text-muted)] uppercase">Live City Feed</span>
                <span className="rounded-full bg-[var(--success)]/20 px-2 py-0.5 text-[11px] font-semibold text-[var(--success)]">
                  Live
                </span>
              </div>
              <div className="space-y-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] p-3">
                  <p className="text-sm font-semibold">Maboneng is building tonight</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Pulse spikes as check-ins climb near Fox Street.</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] p-3">
                  <p className="text-sm font-semibold">New get activated in Braam</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Limited slots at a rooftop node right now.</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] p-3">
                  <p className="text-sm font-semibold">Durban beachfront trending</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Momentum up 42 percent in the last hour.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {featureCards.map((card) => (
              <article
                key={card.title}
                className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5"
              >
                <h3 className="font-[Syne] text-xl font-bold tracking-[-0.01em]">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{card.body}</p>
              </article>
            ))}
          </section>
        </main>
      </div>
    </div>
  )
}
