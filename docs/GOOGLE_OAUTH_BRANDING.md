# Google OAuth Consent Screen — Branding Checklist

The "wants to access your Google Account" page that users see when
clicking "Continue with Google" is configured in Google Cloud Console,
not AWS. This checklist documents what to set there.

## Why this matters

If the consent screen says "Project 604821040168 wants to access your
Google account", users abandon the flow. If it says "Area Code wants
to access your Google account" with your logo, they don't.

## Where to set it

console.cloud.google.com → select your Area Code project → Google Auth
Platform → Branding (and Audience, Clients, Data Access).

If your project is in **Testing** mode, you can publish to **Production**
once the fields below are filled. While testing, only the listed test
users can sign in (max 100). Production mode allows anyone, but if you
upload a logo Google will require **brand verification** before the
unverified-app warning is removed (1–6 weeks, free, paperwork-only).

We currently use `openid email profile` — these are _not_ sensitive
scopes, so OAuth scope verification is not required. Brand verification
(triggered by uploading the app logo) is a separate review.

## Fields to set (Branding tab)

| Field                             | Value                                                         |
| --------------------------------- | ------------------------------------------------------------- |
| App name                          | `Area Code`                                                   |
| User support email                | `support@areacode.co.za` (or whichever inbox you read)        |
| App logo                          | Square PNG, ≤ 1 MB. Use the Area Code mark, not the wordmark. |
| Application home page             | `https://areacode.co.za`                                      |
| Application privacy policy link   | `https://areacode.co.za/legal/privacy`                        |
| Application terms of service link | `https://areacode.co.za/legal/terms`                          |
| Authorized domains                | `areacode.co.za` (and only that)                              |
| Developer contact information     | Your email                                                    |

The privacy policy and terms screens are implemented in
`apps/web/src/screens/PrivacyPolicyScreen.tsx` and `TermsScreen.tsx` and
are routed without the bottom nav so a Google reviewer hitting them
without an account sees the document directly.

## Scopes (Data Access tab)

Confirm only these three are listed:

- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`
- `openid`

If anything else appears, you've got a config drift. Remove it.

## Authorized domains and the AWS Cognito leakage problem

When you first set this project up, four AWS Cognito hostnames may have
appeared in the Authorized domains list:

```
area-code-prod-consumer.auth.us-east-1.amazoncognito.com
area-code-prod-business.auth.us-east-1.amazoncognito.com
area-code-prod-staff.auth.us-east-1.amazoncognito.com
area-code-prod-admin.auth.us-east-1.amazoncognito.com
```

Those leak the AWS pool id onto the consent screen ("to continue to
area-code-prod-consumer..."). To get a clean `areacode.co.za` publisher
line:

1. Stand up the custom Cognito Hosted UI domain `auth.areacode.co.za`
   per `docs/COGNITO_CUSTOM_DOMAIN_RUNBOOK.md`.
2. In Google Cloud → Clients → consumer client, **add** the new redirect
   URI `https://auth.areacode.co.za/oauth2/idpresponse`. Keep the old
   one as fallback for now.
3. Cut the consumer Amplify env over to the custom domain.
4. Once stable, remove the old AWS-Cognito redirect URI from the
   client, then remove the matching authorized domain.
5. Repeat for business / staff / admin pools, or leave them on the
   AWS-hosted domain — only the consumer pool is consumer-facing.

You **cannot** delete an authorized domain while any active OAuth
client still references it as a redirect URI. Google blocks it. Update
the client first, then delete the domain.

## Brand verification (required if you upload a logo)

When Google's verification team reviews you, they check two things:

1. **You own the home-page domain.** Verified via Google Search Console.
2. **The home page links to the privacy policy.** Verified by fetching
   the URL and scanning for an anchor whose href or text mentions
   privacy.

### Step 1 — Verify domain ownership (Search Console)

This must be done with the **same Google account** that owns the Cloud
project (currently `reelagents91@gmail.com`).

1. Go to <https://search.google.com/search-console>.
2. Add property → **Domain** (not URL prefix). Enter `areacode.co.za`.
   Domain verification covers all subdomains in one shot.
3. Search Console gives you a TXT record like
   `google-site-verification=abc123...`.
4. Add it to the apex of the Route 53 hosted zone (`Z0263725FVT0QYF18KLO`):

   ```bash
   aws route53 change-resource-record-sets \
     --hosted-zone-id Z0263725FVT0QYF18KLO \
     --change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"areacode.co.za.","Type":"TXT","TTL":300,"ResourceRecords":[{"Value":"\"google-site-verification=abc123...\""}]}}]}'
   ```

   If a TXT record already exists at the apex (e.g. SPF), add the
   verification value as a second string in the same record — don't
   replace.

5. Wait 5–10 min, then click "Verify" in Search Console.

### Step 2 — Privacy link on the home page

Already in place. `apps/web/src/screens/AuthLanding.tsx` renders a
visible footer with "Privacy Policy", "Terms", and "Contact" links on
the unauthenticated landing page. The privacy policy itself lives at
`/legal/privacy` and is reachable without login.

If you change either the path or the visibility of that footer, brand
verification will fail on re-submission.

### Step 3 — Re-submit

In Google Cloud → Branding → "Branding verification issues" panel, tick
"I have fixed the issues" and request re-verification. Turnaround is
usually a few days but can stretch to a few weeks.

## Test users (only relevant in Testing mode)

Add the email addresses of every person who needs to sign in during the
SA pilot:

- The founder
- Each pilot venue owner
- Pilot staff who'll log in via Google

Once you publish to Production this list is irrelevant.

## Publishing to Production

In Audience tab, the publishing status should read **In production**.
Don't click "Back to testing" — that re-restricts logins to whitelisted
test users.

The OAuth user cap (100 by default) only applies when requesting
unapproved sensitive or restricted scopes. Since we use only
`openid email profile`, the cap doesn't constrain us in practice.

## Sanity checks after publishing

1. Open an incognito window. Go to `areacode.co.za`. Click "Continue
   with Google". The consent screen should show:
   - "Sign in to Area Code" title
   - Your logo
   - Only `openid email profile` permissions listed
   - "areacode.co.za" as the publisher (not the AWS Cognito hostname —
     this only happens once the custom Cognito domain cutover is done)
   - No "this app isn't verified" warning (only after brand
     verification approves)
2. Sign in with a Google account that's not on the test-users list. It
   should work (in Production) or fail with "Access blocked: Authorization
   Error" (in Testing).
3. From an incognito window with no Area Code session, navigate
   directly to `https://areacode.co.za/legal/privacy` and
   `https://areacode.co.za/legal/terms`. Both should render without a
   login prompt.

## What this doesn't cover

- The custom Cognito Hosted UI domain (`auth.areacode.co.za`). See
  `docs/COGNITO_CUSTOM_DOMAIN_RUNBOOK.md`. The Google branding work
  here and the Cognito branding work there are independent — both
  matter, both should be done.
- Cognito Hosted UI CSS — already applied via the AWS CLI. Affects only
  the rare case where Cognito needs to show its own login form.
