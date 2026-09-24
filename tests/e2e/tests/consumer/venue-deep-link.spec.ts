/**
 * Venue deep-link arrival — `/node/{slug}` and `/map?venue={slug}&src=…`
 *
 * Spec: .kiro/specs/proof-of-demand (Requirements 1.1, 1.7), task 1.7
 *
 * Implementation under test:
 *   - `apps/web/src/lib/venueArrival.ts` — parses both link shapes, stashes
 *     `{ slug, source }` in sessionStorage, normalises the address bar to `/map`
 *   - `apps/web/src/hooks/useVenueArrival.ts` — resolves the slug against the
 *     loaded city payload and hands the node to the Focus_Signal path
 *   - `apps/web/src/App.tsx` — `pathToRoute` maps `/node/{slug}` to the map, and
 *     a resume effect returns a freshly signed-in visitor to it
 *
 * What these tests pin:
 *   1. A logged-out arrival lands the venue as the Active_Venue in Browse_Mode,
 *      and the Open_Source survives the sign-in round trip (R1.7): the stash
 *      still carries it while the login screen has replaced the map, and it is
 *      consumed only on the authenticated pass — which is where the Venue_Open
 *      is recorded (task 2.5).
 *   2. A logged-in arrival lands on the same card directly.
 *   3. The source is read from the link, not hardcoded: `src=push` stays `push`.
 *
 * In every case Commit_Mode must NOT auto-open: Browse stays non-modal (no
 * backdrop, no `aria-modal`), and details open only from "View details"
 * (`.kiro/steering/map-carousel.md`).
 *
 * Environment: like `map-discovery.spec.ts`, this runs against a real stack with
 * real Mapbox — nothing is stubbed. Slug resolution is slug-to-id against the
 * city payload, so the test reads a real venue from `GET /v1/nodes/{city}` and
 * skips with a clear reason when the environment has no public node seeded.
 */

import type { APIRequestContext, Page } from '@playwright/test'

import { TEST_ACCOUNTS, TEST_PASSWORD } from '../../support/env.js'
import { expect, test } from '../../support/fixtures.js'
import { auth, consumer } from '../../support/selectors.js'
import { firstPublicNode, type SeedVenue } from '../../support/test-data.js'

/**
 * sessionStorage key written by `captureVenueArrivalFromLocation`. Mirrors
 * `PENDING_VENUE_ARRIVAL_KEY` in `apps/web/src/lib/venueArrival.ts`; this
 * package is standalone (not in the pnpm workspace) so it cannot import it.
 * The key and the `{ slug, source }` shape are the contract under test.
 */
const ARRIVAL_STASH_KEY = 'pendingVenueArrival'

type ArrivalStash = { slug?: string; source?: string } | null

async function readArrivalStash(page: Page): Promise<ArrivalStash> {
  return await page.evaluate((key) => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw ? (JSON.parse(raw) as { slug?: string; source?: string }) : null
    } catch {
      // Private-mode browsers throw on sessionStorage access.
      return null
    }
  }, ARRIVAL_STASH_KEY)
}

/**
 * Sign in on the current tab via the SPA's auth entry (`/login`).
 *
 * The `loginAs` fixture starts a fresh visit at the portal root, which is the
 * wrong entry here: this flow needs the login screen reached *after* the
 * arrival, so the stash can be read while the map is off screen. A same-tab
 * navigation keeps sessionStorage, which is exactly the round trip R1.7 covers.
 */
async function signInInPlace(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await auth.emailField(page).waitFor({ state: 'visible', timeout: 20_000 })
  await auth.emailField(page).fill(email)
  await auth.passwordField(page).fill(TEST_PASSWORD())
  await auth.submitButton(page).click()
  // A brand-new account lands in onboarding first; dismiss it so the map shows.
  const skip = page.getByRole('button', { name: /^skip$/i }).first()
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) await skip.click()
}

/** The venue the arrival points at, or null when nothing is seeded. */
async function arrivalVenue(anonApiClient: () => Promise<APIRequestContext>): Promise<SeedVenue | null> {
  const api = await anonApiClient()
  const venue = await firstPublicNode(api)
  return venue?.slug ? venue : null
}

/** Browse_Mode, led by the arrival venue, with no Commit_Mode takeover. */
async function expectBrowseLedBy(page: Page, venue: SeedVenue): Promise<void> {
  const carousel = consumer.peekCarousel(page)
  await expect(carousel).toBeVisible({ timeout: 25_000 })
  await expect(carousel).toHaveAttribute('data-mode', 'browse')
  await expect(consumer.activeVenueCard(page)).toHaveAttribute('data-venue-card', venue.id, { timeout: 20_000 })
  // No Commit_Mode auto-open: Browse is the non-modal strip (map stays live).
  await expect(consumer.sheetBackdrop(page)).toHaveCount(0)
  await expect(consumer.sheetPanel(page)).not.toHaveAttribute('aria-modal', 'true')
  // Details remain one deliberate tap away rather than already open.
  await expect(consumer.viewDetails(page)).toBeVisible()
}

test.describe('Consumer — venue deep-link arrival (proof-of-demand R1.1, R1.7)', () => {
  test('logged out: /node/{slug} lands on the venue card and keeps the source through sign-in', async ({
    page,
    anonApiClient,
  }) => {
    const venue = await arrivalVenue(anonApiClient)
    if (!venue) {
      test.skip(true, 'No public node in the city payload — seed a venue to enable this test')
      return
    }

    // ── Arrival, unauthenticated. The map is public, so the venue surfaces. ──
    await page.goto(`/node/${venue.slug}`)
    await expect(consumer.map(page)).toBeVisible({ timeout: 25_000 })
    // The address bar is normalised so back/forward cannot replay the arrival.
    await expect(page).toHaveURL(/\/map$/, { timeout: 15_000 })

    // The link carried no `src`, so the honest default for a link surface is
    // `share` (a direct `/node/{slug}` hit and the Share_Preview redirect,
    // which appends `src=share`, converge on the same value).
    await expect.poll(() => readArrivalStash(page), { timeout: 15_000 }).toEqual({ slug: venue.slug, source: 'share' })

    await expectBrowseLedBy(page, venue)

    // ── Sign-in round trip. The map is replaced by the auth screen; the
    //    arrival (and its source) must still be pending when we come back. ──
    await page.goto('/login')
    await auth.emailField(page).waitFor({ state: 'visible', timeout: 20_000 })
    expect(await readArrivalStash(page), 'the source must survive the login round trip (R1.7)').toEqual({
      slug: venue.slug,
      source: 'share',
    })

    await signInInPlace(page, TEST_ACCOUNTS.consumerA.email)

    // Back on the map, led by the same venue, still in Browse_Mode.
    await expect(consumer.map(page)).toBeVisible({ timeout: 25_000 })
    await expectBrowseLedBy(page, venue)

    // Consumed on the authenticated pass: that is where the Venue_Open is
    // recorded with the stashed source, so the stash is released exactly once.
    await expect.poll(() => readArrivalStash(page), { timeout: 15_000 }).toBeNull()
  })

  test('logged in: /node/{slug} lands on the venue card directly', async ({ page, anonApiClient }) => {
    const venue = await arrivalVenue(anonApiClient)
    if (!venue) {
      test.skip(true, 'No public node in the city payload — seed a venue to enable this test')
      return
    }

    await signInInPlace(page, TEST_ACCOUNTS.consumerA.email)
    await expect(consumer.map(page)).toBeVisible({ timeout: 25_000 })

    await page.goto(`/node/${venue.slug}`)
    await expect(consumer.map(page)).toBeVisible({ timeout: 25_000 })
    await expect(page).toHaveURL(/\/map$/, { timeout: 15_000 })

    await expectBrowseLedBy(page, venue)
    // No round trip to wait for: the arrival is consumed on this first pass.
    await expect.poll(() => readArrivalStash(page), { timeout: 15_000 }).toBeNull()
  })

  test('push deep link keeps src=push as the Open_Source', async ({ page, anonApiClient }) => {
    const venue = await arrivalVenue(anonApiClient)
    if (!venue) {
      test.skip(true, 'No public node in the city payload — seed a venue to enable this test')
      return
    }

    // The notification-click shape (task 2.6). Read logged out so the stash is
    // still pending and its source can be inspected.
    await page.goto(`/map?venue=${venue.slug}&src=push`)
    await expect(consumer.map(page)).toBeVisible({ timeout: 25_000 })
    await expect(page).toHaveURL(/\/map$/, { timeout: 15_000 })

    await expect.poll(() => readArrivalStash(page), { timeout: 15_000 }).toEqual({ slug: venue.slug, source: 'push' })
    await expectBrowseLedBy(page, venue)
  })
})
