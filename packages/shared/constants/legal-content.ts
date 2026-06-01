/**
 * Structured, render-agnostic legal copy for the consumer Privacy Policy and
 * Terms of Service. Kept as plain data (no JSX) so both the web (HTML) and
 * mobile (React Native) surfaces can render the same source text without the
 * wording drifting between platforms.
 *
 * The web app currently renders its own richly-formatted versions; this module
 * is the canonical plain-text source for the mobile app and the intended
 * single source for both surfaces going forward. Any legal review should
 * update this file. Contact: privacy@areacode.co.za / legal@areacode.co.za.
 */

export interface LegalSection {
  heading: string
  /** One or more paragraphs. Bullet lists are represented as `• ` prefixed lines. */
  body: string[]
}

export interface LegalDocument {
  title: string
  lastUpdated: string
  intro: string[]
  sections: LegalSection[]
}

export const PRIVACY_POLICY: LegalDocument = {
  title: 'Privacy Policy',
  lastUpdated: '16 May 2026',
  intro: [
    'Area Code ("we", "us", "our") is a venue-discovery platform operated from South Africa. This policy explains what personal information we collect when you use the Area Code consumer app, why we collect it, how we use it, and the rights you have over it.',
    "We are committed to processing your personal information in line with South Africa's Protection of Personal Information Act (POPIA, Act No. 4 of 2013).",
  ],
  sections: [
    {
      heading: '1. Who we are',
      body: [
        'Responsible party: Area Code, Johannesburg, South Africa.',
        'Information officer: contactable at privacy@areacode.co.za.',
      ],
    },
    {
      heading: '2. What we collect',
      body: [
        'When you sign up and use the app, we collect:',
        '• Account data: email address, display name, profile picture, and a unique account identifier issued by Amazon Cognito. If you sign in with Google, we receive your name, email, and profile picture from Google.',
        '• Check-in metadata: the venue you checked in at, the timestamp, and (briefly, in memory) a GPS reading used to verify you are near the venue. The GPS reading is discarded immediately after verification — we do not store your coordinates or build a location history.',
        '• Music taste data (optional): if you connect Spotify or Apple Music, we read your top genres and aggregated taste profile. We do not store your individual listening history.',
        '• Reward and tier data: the rewards you have claimed, your loyalty tier, your streak, and your leaderboard position.',
        '• Device and connection data: IP address, user agent, and approximate device capabilities, used for security and performance.',
        'What we never collect: phone numbers, identity numbers, payment card details, persistent location history, or biometric data.',
      ],
    },
    {
      heading: '3. Why we collect it',
      body: [
        '• To create and operate your Area Code account.',
        '• To verify that check-ins are genuine (proximity check at the moment of check-in only).',
        '• To award rewards, tiers, and leaderboard positions.',
        '• To produce the live venue pulse score and features such as the music taste profile.',
        '• To produce anonymized, aggregated intelligence reports for participating businesses. These never contain your identity — only group-level counts and percentages.',
        '• To detect abuse, fraud, and platform misuse, and to respond to your support questions.',
      ],
    },
    {
      heading: '4. How long we keep it',
      body: [
        '• Account data: kept while your account is active. On deletion we soft-delete immediately and hard-delete within 30 days (POPIA Article 14).',
        '• Check-in records: kept while your account is active to compute streaks, tiers, and leaderboard standing.',
        '• Casual-customer ("First-Get") tokens: kept up to 60 days, then permanently deleted. These contain no personal information.',
        '• Server logs: retained up to 90 days for security and debugging.',
      ],
    },
    {
      heading: '5. Who we share it with',
      body: [
        'We do not sell your personal information. We share it only as necessary with: Amazon Web Services (infrastructure); Google (only if you sign in with Google); Spotify or Apple Music (only if you connect them); Sentry (limited diagnostics); participating businesses (anonymized aggregate only, unless you check in publicly with public visibility); and law enforcement (only on a valid legal request).',
      ],
    },
    {
      heading: '6. International transfers',
      body: [
        'Your data is stored on AWS infrastructure in the United States, under standard contractual safeguards as required by POPIA Section 72.',
      ],
    },
    {
      heading: '7. Your rights',
      body: [
        'Under POPIA you can access, correct, delete, and object to processing of your personal information, and withdraw consent for optional features. Use the data controls in your profile or email privacy@areacode.co.za.',
        'You may lodge a complaint with the Information Regulator of South Africa at inforegulator.org.za.',
      ],
    },
    {
      heading: '8. Children',
      body: [
        'Area Code is not intended for users under 18. We do not knowingly collect personal information from children.',
      ],
    },
    {
      heading: '9. Storage',
      body: [
        'We use on-device storage to keep you signed in and remember your settings. We do not use third-party advertising or analytics cookies. Crash and performance monitoring runs without cookies.',
      ],
    },
    {
      heading: '10. Changes',
      body: [
        'We may update this policy as the platform evolves. The "Last updated" date reflects the most recent change. Material changes will be notified in-app.',
      ],
    },
    {
      heading: '11. Contact',
      body: ['For any privacy question, request, or complaint: privacy@areacode.co.za.'],
    },
  ],
}

export const TERMS_OF_SERVICE: LegalDocument = {
  title: 'Terms of Service',
  lastUpdated: '16 May 2026',
  intro: [
    'These terms govern your use of the Area Code consumer app. By creating an account or signing in, you agree to them.',
  ],
  sections: [
    {
      heading: '1. Who can use Area Code',
      body: [
        'You must be 18 years or older. You must provide accurate information when you sign up and keep your credentials confidential. You are responsible for everything that happens under your account.',
      ],
    },
    {
      heading: '2. What Area Code is',
      body: [
        'Area Code is a venue-discovery and rewards platform. Rewards are issued and honoured by individual venues, not by Area Code. Area Code is not the seller of any reward.',
      ],
    },
    {
      heading: '3. Honest check-ins',
      body: [
        'You agree to check in only when you are physically present at a venue. We use a brief GPS proximity check and other signals to detect dishonest check-ins, and may invalidate check-ins, withhold rewards, or suspend accounts where we have reasonable grounds to believe the system is being abused.',
      ],
    },
    {
      heading: '4. Rewards',
      body: [
        "Rewards are configured and granted by participating venues, each stating its own conditions, expiry, and redemption rules. We are not responsible if a venue withdraws a reward or changes its conditions for reasons within the venue's control.",
      ],
    },
    {
      heading: '5. Streaming connections',
      body: [
        'If you connect Spotify or Apple Music, you authorise Area Code to read aggregated taste data while the connection is active. You can revoke it at any time in your profile or with the provider.',
      ],
    },
    {
      heading: '6. Content you submit',
      body: [
        'You retain ownership of content you submit and grant us a worldwide, non-exclusive, royalty-free licence to host and display it as needed to operate the platform. We may remove content that violates these terms or the law.',
      ],
    },
    {
      heading: '7. Acceptable use',
      body: [
        'You may not: gain unauthorised access to any account or system; disrupt the platform or circumvent rate limits; reverse-engineer the software except where the law permits; scrape data without written authorisation; harass, impersonate, or post hate speech or unlawful content; or use the platform for fraud.',
      ],
    },
    {
      heading: '8. Account suspension',
      body: [
        'We may suspend or terminate your account for breach of these terms, legal requirement, or security risk. Where reasonable we will notify you and let you export your data first.',
      ],
    },
    {
      heading: '9. Service availability',
      body: [
        'We aim for high availability but do not guarantee uninterrupted service. We may schedule maintenance, change features, or discontinue parts of the service with reasonable notice where possible.',
      ],
    },
    {
      heading: '10. Intellectual property',
      body: [
        'The Area Code name, logo, design, software, and related IP are owned by Area Code. Nothing in these terms transfers that ownership to you.',
      ],
    },
    {
      heading: '11. Disclaimers',
      body: [
        'Area Code is provided "as is". We do not warrant the platform will be error-free or that any specific reward or venue information is available, accurate, or current. To the fullest extent permitted by law we exclude all implied warranties.',
      ],
    },
    {
      heading: '12. Limitation of liability',
      body: [
        'To the maximum extent permitted by law, Area Code is not liable for indirect, incidental, special, or consequential damages. Nothing limits liability that cannot be limited under South African law, including your rights under the Consumer Protection Act.',
      ],
    },
    {
      heading: '13. Privacy',
      body: [
        'Our use of your personal information is described in our Privacy Policy. By using Area Code you confirm you have read it.',
      ],
    },
    {
      heading: '14. Changes to these terms',
      body: [
        'We may revise these terms over time. The "Last updated" date reflects the current version. Continued use after a change is posted constitutes acceptance of the revised terms.',
      ],
    },
    {
      heading: '15. Governing law',
      body: [
        'These terms are governed by the laws of the Republic of South Africa, subject to the non-exclusive jurisdiction of the South African courts.',
      ],
    },
    {
      heading: '16. Contact',
      body: ['For any question about these terms: legal@areacode.co.za.'],
    },
  ],
}
