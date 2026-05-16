import { ChevronLeft } from 'lucide-react'
import type { AppRoute } from '../types'

interface TermsScreenProps {
  onNavigate: (route: AppRoute) => void
}

/**
 * Public terms of service. Linked from the unauthenticated landing page and
 * referenced in the Google OAuth consent screen branding. Must remain
 * publicly accessible without login.
 *
 * Note: This is a working draft. It should be reviewed by a South African
 * attorney before relying on it for production legal coverage.
 */
export function TermsScreen({ onNavigate }: TermsScreenProps) {
  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)] overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <button
          onClick={() => onNavigate('landing')}
          className="mb-6 inline-flex items-center gap-1 text-sm text-[var(--text-muted)] transition-all active:scale-95"
          aria-label="Back"
        >
          <ChevronLeft size={16} strokeWidth={2} /> Back
        </button>

        <h1 className="font-[Syne] text-3xl font-extrabold tracking-tight mb-2">Terms of Service</h1>
        <p className="text-sm text-[var(--text-muted)] mb-8">Last updated: 16 May 2026</p>

        <section className="space-y-6 text-sm leading-relaxed text-[var(--text-secondary)]">
          <p>
            These terms govern your use of the Area Code consumer app at{' '}
            <a href="https://areacode.co.za" className="text-[var(--accent)] underline">
              areacode.co.za
            </a>
            . By creating an account or signing in, you agree to them.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">1. Who can use Area Code</h2>
          <p>
            You must be 18 years or older to use Area Code. You must provide accurate information when you sign up and
            keep your account credentials confidential. You are responsible for everything that happens under your
            account.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">2. What Area Code is</h2>
          <p>
            Area Code is a venue-discovery and rewards platform. You can check in at participating venues, earn rewards
            from those venues, and discover what is happening around you. Rewards are issued and honoured by the
            individual venues, not by Area Code. Area Code is not the seller of any reward.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">3. Honest check-ins</h2>
          <p>
            You agree to check in only when you are physically present at a venue. We use a brief GPS proximity check
            and other signals to detect dishonest check-ins. We may invalidate check-ins, withhold rewards, suspend, or
            terminate accounts where we have reasonable grounds to believe the system is being abused. Repeated or
            coordinated abuse will result in permanent removal.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">4. Rewards</h2>
          <p>
            Rewards are configured and granted by participating venues. Each reward states its conditions, expiry, and
            redemption rules. We are not responsible if a venue withdraws a reward, changes its conditions, or refuses
            redemption for reasons within the venue&apos;s control. Where we are notified of a venue acting in bad faith
            we will investigate and may remove that venue from the platform.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">5. Streaming connections</h2>
          <p>
            If you connect a Spotify or Apple Music account, you authorise Area Code to read aggregated taste data from
            that service for as long as the connection is active. You can revoke the connection at any time in your
            profile settings or directly with the streaming provider.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">6. Content you submit</h2>
          <p>
            You retain ownership of content you submit (display name, profile picture, friend connections, check-ins).
            You grant us a worldwide, non-exclusive, royalty-free licence to host, store, and display this content as
            needed to operate the platform. We may remove content that violates these terms, applicable law, or the
            rights of others.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">7. Acceptable use</h2>
          <p>You may not use Area Code to:</p>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>Attempt to gain unauthorised access to any account, system, or data.</li>
            <li>Interfere with or disrupt the platform, or attempt to circumvent rate limits or security controls.</li>
            <li>Reverse-engineer, decompile, or extract the source code, except where the law expressly permits.</li>
            <li>Scrape data, except in volumes and at rates we have explicitly authorised in writing.</li>
            <li>
              Harass, threaten, defame, impersonate, or doxx any person, or post hate speech, sexually explicit
              material, or content that promotes violence or unlawful conduct.
            </li>
            <li>Use the platform to commit fraud or to launder gains from criminal activity.</li>
          </ul>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">8. Account suspension</h2>
          <p>
            We may suspend or terminate your account if you breach these terms, if we are required to do so by law, or
            if your use poses a security or integrity risk to the platform. Where reasonable, we will notify you and
            allow you to export your data first.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">9. Service availability</h2>
          <p>
            We aim for high availability but we do not guarantee uninterrupted service. We may schedule maintenance,
            change features, or discontinue parts of the service. We will give reasonable notice of material changes
            where we can.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">10. Intellectual property</h2>
          <p>
            The Area Code name, logo, design, software, and all related intellectual property are owned by Area Code.
            Nothing in these terms transfers any of that ownership to you.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">11. Disclaimers</h2>
          <p>
            Area Code is provided &quot;as is&quot;. We do not warrant that the platform will be error-free, that any
            specific reward will be available at any specific time, or that any information shown about a venue is
            accurate or current. To the fullest extent permitted by law, we exclude all implied warranties.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">12. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, Area Code is not liable for indirect, incidental, special, or
            consequential damages, or for loss of profits, revenue, data, or goodwill arising out of or in connection
            with your use of the platform. Nothing in these terms limits any liability that cannot be limited under
            South African law (including liability for fraud, gross negligence, or any rights you have under the
            Consumer Protection Act).
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">13. Privacy</h2>
          <p>
            Our collection and use of your personal information is described in our{' '}
            <a href="/legal/privacy" className="text-[var(--accent)] underline">
              Privacy Policy
            </a>
            . By using Area Code you confirm you have read it.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">14. Changes to these terms</h2>
          <p>
            We may revise these terms over time. The &quot;Last updated&quot; date at the top reflects the current
            version. If a change is material we will notify you in-app or by email. Continued use after a change is
            posted constitutes acceptance of the revised terms.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">15. Governing law</h2>
          <p>
            These terms are governed by the laws of the Republic of South Africa. Any dispute will be subject to the
            non-exclusive jurisdiction of the South African courts.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">16. Contact</h2>
          <p>
            For any question about these terms:{' '}
            <a href="mailto:legal@areacode.co.za" className="text-[var(--accent)] underline">
              legal@areacode.co.za
            </a>
            .
          </p>
        </section>

        <div className="mt-12 pt-6 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
          <a href="/legal/privacy" className="text-[var(--accent)] underline">
            Privacy Policy
          </a>
          {' · '}
          <a href="/" className="text-[var(--accent)] underline">
            Home
          </a>
        </div>
      </div>
    </div>
  )
}
