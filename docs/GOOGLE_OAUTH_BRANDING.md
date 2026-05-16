# Google OAuth Consent Screen — Branding Checklist

The "wants to access your Google Account" page that users see when
clicking "Continue with Google" is configured in Google Cloud Console,
not AWS. This checklist documents what to set there.

## Why this matters

If the consent screen says "Project 604821040168 wants to access your
Google account", users abandon the flow. If it says "Area Code wants
to access your Google account" with your logo, they don't.

## Where to set it

console.cloud.google.com → select your Area Code project → APIs &
Services → OAuth consent screen.

If your project is in **Testing** mode, you can publish to **Production**
once the fields below are filled. While testing, only the listed test
users can sign in (max 100). Production mode allows anyone, but if you
request sensitive scopes you'll need verification (1-6 weeks).

We currently use `openid email profile` — these are _not_ sensitive
scopes, so verification is not required for production publication.

## Fields to set

| Field                             | Value                                                         |
| --------------------------------- | ------------------------------------------------------------- |
| App name                          | `Area Code`                                                   |
| User support email                | `support@areacode.co.za` (or whatever inbox you read)         |
| App logo                          | Square PNG, ≤ 1 MB. Use the Area Code mark, not the wordmark. |
| Application home page             | `https://areacode.co.za`                                      |
| Application privacy policy link   | `https://areacode.co.za/privacy`                              |
| Application terms of service link | `https://areacode.co.za/terms`                                |
| Authorized domains                | `areacode.co.za` (and only that)                              |
| Developer contact information     | Your email                                                    |

## Scopes (already correct)

Confirm only these three are listed:

- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`
- `openid`

If anything else appears, you've got a config drift. Remove it.

## Test users (only relevant in Testing mode)

Add the email addresses of every person who needs to sign in during the
SA pilot:

- The founder
- Each pilot venue owner
- Pilot staff who'll log in via Google

Once you publish to Production this list is irrelevant.

## Publishing to Production

In OAuth consent screen, click "Publish app". Confirm. From that point
on, anyone with a Google account can sign in to Area Code, and the
"unverified app" warning disappears (because we don't request sensitive
scopes).

The "Verification" workflow is only required when you request scopes
that touch user data beyond email/profile (Drive, Calendar, etc).
Since we don't, we skip it.

## Sanity checks after publishing

1. Open an incognito window. Go to `areacode.co.za`. Click "Continue
   with Google". The consent screen should show:
   - "Sign in to Area Code" title
   - Your logo
   - Only `openid email profile` permissions listed
   - "areacode.co.za" as the publisher
   - No "this app isn't verified" warning
2. Sign in with a Google account that's not on the test-users list. It
   should work (in Production) or fail with "Access blocked: Authorization
   Error" (in Testing).

## What this doesn't cover

- The custom Cognito Hosted UI domain (`auth.areacode.co.za`). See
  `docs/COGNITO_CUSTOM_DOMAIN_RUNBOOK.md`. The Google branding work
  here and the Cognito branding work there are independent — both
  matter, both should be done.
- Cognito Hosted UI CSS — already applied via the AWS CLI. Affects only
  the rare case where Cognito needs to show its own login form.
