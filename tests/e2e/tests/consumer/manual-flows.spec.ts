/**
 * §1.1 Google sign-in, §1.3 GPS check-in (real device camera path),
 * §1.5 Push notification permission, §1.8 Account deletion w/ data export.
 *
 * These steps cannot be reliably automated. We register them with
 * `test.fixme()` so they show up in the report as "Known manual" rather
 * than silently absent. Update UAT_CHECKLIST.md after each manual run.
 */

import { test } from '@playwright/test'

test.describe('Consumer — manual checks (intentionally fixme)', () => {
  test.fixme('Google sign-in completes and lands on map', async () => {
    // Google blocks headless OAuth. Verify on a real desktop browser.
  })

  test.fixme('SMS OTP delivers and back-nav preserves phone', async () => {
    // Requires a real phone or a Cognito sandbox SMS sandbox config.
  })

  test.fixme('QR check-in via phone camera deep link', async () => {
    // Camera-on-phone scan; verify on a real device.
  })

  test.fixme('Push notification permission prompt on first claim', async () => {
    // Browser permission UI is not exposed to Playwright reliably.
  })

  test.fixme('Account deletion flow & data export download', async () => {
    // Destructive — keep manual until a soft-delete dry-run mode exists.
  })
})
