import { ChevronLeft } from 'lucide-react'
import type { AppRoute } from '../types'

interface PrivacyPolicyScreenProps {
  onNavigate: (route: AppRoute) => void
}

/**
 * Public privacy policy. Linked from the unauthenticated landing page and
 * referenced in the Google OAuth consent screen branding. Must remain
 * publicly accessible without login — Google's OAuth verification team
 * fetches this URL.
 *
 * Contact: privacy@areacode.co.za
 *
 * Note: This is a working draft based on what the platform actually does
 * (see SALES_PITCH.md "Privacy by Design" and the POPIA references in
 * the codebase). It should be reviewed by a South African attorney before
 * relying on it for production legal coverage.
 */
export function PrivacyPolicyScreen({ onNavigate }: PrivacyPolicyScreenProps) {
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

        <h1 className="font-[Syne] text-3xl font-extrabold tracking-tight mb-2">Privacy Policy</h1>
        <p className="text-sm text-[var(--text-muted)] mb-8">Last updated: 16 May 2026</p>

        <section className="space-y-6 text-sm leading-relaxed text-[var(--text-secondary)]">
          <p>
            Area Code (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is a venue-discovery platform operated from
            South Africa. This policy explains what personal information we collect from you when you use the Area Code
            consumer app at{' '}
            <a href="https://areacode.co.za" className="text-[var(--accent)] underline">
              areacode.co.za
            </a>
            , why we collect it, how we use it, and the rights you have over it.
          </p>
          <p>
            We are committed to processing your personal information in line with South Africa&apos;s Protection of
            Personal Information Act (POPIA, Act No. 4 of 2013).
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">1. Who we are</h2>
          <p>
            <strong>Responsible party:</strong> Area Code, Johannesburg, South Africa.
            <br />
            <strong>Information officer:</strong> contactable at{' '}
            <a href="mailto:privacy@areacode.co.za" className="text-[var(--accent)] underline">
              privacy@areacode.co.za
            </a>
            .
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">2. What we collect</h2>
          <p>When you sign up and use the app, we collect:</p>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>
              <strong>Account data:</strong> email address, display name, profile picture, and a unique account
              identifier issued by Amazon Cognito. If you sign in with Google, we receive your name, email, and profile
              picture from Google in line with the consent shown on Google&apos;s sign-in screen.
            </li>
            <li>
              <strong>Check-in metadata:</strong> the venue you checked in at, the timestamp, and (briefly, in memory) a
              GPS reading used to verify you are physically near the venue. The GPS reading is discarded immediately
              after verification — we do not store your latitude or longitude, and we do not build a location history.
            </li>
            <li>
              <strong>Music taste data (optional):</strong> if you connect a Spotify or Apple Music account, we read
              your top genres and aggregated taste profile to power the venue music profile feature. We do not store
              your individual track listening history.
            </li>
            <li>
              <strong>Reward and tier data:</strong> the rewards you have claimed, your loyalty tier, your streak, and
              your leaderboard position.
            </li>
            <li>
              <strong>Device and connection data:</strong> IP address, browser user agent, and approximate device
              capabilities, used for security, fraud prevention, and performance.
            </li>
            <li>
              <strong>Communications:</strong> when you contact our support team, the message you send and our reply.
            </li>
          </ul>
          <p>
            <strong>What we never collect:</strong> phone numbers, identity numbers, payment card details (we do not
            charge consumers), persistent location history, or biometric data.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">3. Why we collect it</h2>
          <p>We process your personal information only for the following purposes:</p>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>To create and operate your Area Code account.</li>
            <li>To verify that check-ins are genuine (proximity check at the moment of check-in only).</li>
            <li>To award rewards, tiers, and leaderboard positions.</li>
            <li>To produce the live venue pulse score and to power features such as the music taste profile.</li>
            <li>
              To produce <strong>anonymized, aggregated</strong> intelligence reports for participating businesses.
              These reports never contain your name, email, or any other identifier — only group-level counts and
              percentages (for example, &quot;28% of visitors this week were first-timers&quot;).
            </li>
            <li>To detect abuse, fraud, and platform misuse.</li>
            <li>To respond to your support questions.</li>
          </ul>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">4. How long we keep it</h2>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>
              <strong>Account data:</strong> kept while your account is active. When you delete your account, we
              soft-delete immediately and hard-delete within 30 days, in line with POPIA Article 14.
            </li>
            <li>
              <strong>Check-in records:</strong> kept while your account is active to compute streaks, tiers, and
              leaderboard standing. Deleted with your account.
            </li>
            <li>
              <strong>Casual-customer (&quot;First-Get&quot;) tokens:</strong> tokens issued at venue tills are kept for
              up to 60 days (a 30-day conversion window plus a 30-day audit grace period), then permanently deleted.
              These tokens contain no personal information.
            </li>
            <li>
              <strong>Server logs:</strong> retained for up to 90 days for security and debugging purposes.
            </li>
          </ul>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">5. Who we share it with</h2>
          <p>
            We do not sell your personal information. We share it only with the following categories of recipients, and
            only to the extent necessary:
          </p>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>
              <strong>Amazon Web Services (AWS):</strong> our infrastructure provider, hosting our database, files, and
              compute. Data is stored in the AWS US East (N. Virginia) region under standard contractual safeguards.
            </li>
            <li>
              <strong>Google (only if you sign in with Google):</strong> Google receives a sign-in request and returns
              your basic profile information.
            </li>
            <li>
              <strong>Spotify or Apple Music (only if you connect them):</strong> we exchange OAuth tokens with your
              streaming provider to read your taste data.
            </li>
            <li>
              <strong>Sentry:</strong> error-monitoring service that may receive limited diagnostic information when the
              app encounters a bug.
            </li>
            <li>
              <strong>Participating businesses:</strong> only in <em>anonymized aggregate form</em>. A business sees
              percentages and counts, never your identity. The single exception is when you have set your visibility to
              &quot;public&quot; and choose to check in publicly, in which case your display name and avatar appear on
              that venue&apos;s live check-in feed.
            </li>
            <li>
              <strong>Law enforcement:</strong> only in response to a valid legal request and only the minimum required
              by that request.
            </li>
          </ul>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">6. International transfers</h2>
          <p>
            Your data is stored on AWS infrastructure in the United States. AWS is bound by industry-standard data
            processing terms and adequate safeguards as required by POPIA Section 72.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">7. Your rights</h2>
          <p>Under POPIA, you have the right to:</p>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>
              <strong>Access</strong> the personal information we hold about you. Use the &quot;Export my data&quot;
              button in your profile, or email{' '}
              <a href="mailto:privacy@areacode.co.za" className="text-[var(--accent)] underline">
                privacy@areacode.co.za
              </a>
              .
            </li>
            <li>
              <strong>Correct</strong> personal information that is inaccurate. Edit your profile in the app, or email
              us.
            </li>
            <li>
              <strong>Delete</strong> your personal information. Use &quot;Delete my account&quot; in the app, or email
              us. We complete erasure within 30 days.
            </li>
            <li>
              <strong>Object</strong> to processing, or withdraw consent for optional features (for example, your music
              taste link). Withdraw at any time in your profile settings.
            </li>
            <li>
              <strong>Lodge a complaint</strong> with the Information Regulator of South Africa at{' '}
              <a href="https://inforegulator.org.za" className="text-[var(--accent)] underline">
                inforegulator.org.za
              </a>
              .
            </li>
          </ul>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">8. Children</h2>
          <p>
            Area Code is not intended for users under 18. We do not knowingly collect personal information from
            children. If you become aware that a child has registered an account, contact us and we will delete it.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">9. Cookies and storage</h2>
          <p>
            We use browser local storage to keep you signed in and to remember your settings. We do not use third-party
            advertising cookies. We use a single first-party error-monitoring cookie set by Sentry for crash reporting.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">10. Changes</h2>
          <p>
            We may update this policy as the platform evolves. The &quot;Last updated&quot; date at the top reflects the
            most recent change. Material changes will be notified in-app.
          </p>

          <h2 className="font-[Syne] text-xl font-bold text-[var(--text-primary)] pt-4">11. Contact</h2>
          <p>
            For any privacy question, request, or complaint:{' '}
            <a href="mailto:privacy@areacode.co.za" className="text-[var(--accent)] underline">
              privacy@areacode.co.za
            </a>
            .
          </p>
        </section>

        <div className="mt-12 pt-6 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
          <a href="/legal/terms" className="text-[var(--accent)] underline">
            Terms of Service
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
