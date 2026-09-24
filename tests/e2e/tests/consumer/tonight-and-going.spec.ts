/**
 * Tonight and Going — the anticipation and intent magnets on the consumer map.
 *
 * Spec: .kiro/specs/proof-of-demand (Requirements 8.5 to 8.9, 9.2 to 9.6),
 * task 12.3 (R13.3).
 *
 * Implementation under test:
 *   - `apps/web/src/components/VenueCard.tsx` — the one Tonight line on a
 *     Browse_Mode card, below the pulse row (`data-venue-card-tonight`)
 *   - `apps/web/src/components/TonightBlock.tsx` — the Tonight card on the venue
 *     detail: heading, headline, start, featured get
 *   - `apps/web/src/components/GoingControl.tsx` — the toggle, the count line and
 *     the reminder offer
 *   - `packages/shared/lib/going.ts` — `goingCountToShow`, the one rule for what
 *     a consumer may be told about other people's marks
 *
 * What these tests pin:
 *   1. A venue with a published night shows exactly one Tonight line on its card;
 *      a venue with nothing published shows none (no placeholder).
 *   2. The detail block renders the headline and the start, and its heading
 *      under-claims: "In the room now" only when the backend resolved a live
 *      crowd, "Expected tonight" otherwise.
 *   3. The Going toggle records intent and withdraws it, and its wording stays
 *      "marked going" — never a presence claim.
 *   4. The threshold copy: a count is named only at or above the
 *      Going_Threshold and only when the venue has a Tonight.
 *
 * Deliberately NOT covered here (task 1.7 owns it):
 * `venue-deep-link.spec.ts` pins the `/node/{slug}` arrival itself, the
 * Open_Source stash and the no-auto-Commit rule. This spec only *uses* the deep
 * link as the reliable way to land on a chosen venue.
 *
 * Environment: runs against a real stack with real Mapbox, like
 * `map-discovery.spec.ts`. Venues are read from `GET /v1/nodes/{city}` and each
 * test skips with a clear reason when the environment has no venue with the
 * property it needs (see the seeded figures in `docs/UAT_PROOF_OF_DEMAND.md`:
 * Kudu Bar 5 going, Thembi Coffee 2, Loft 46 0, all three with a Tonight).
 */

import type { APIRequestContext, Page } from '@playwright/test'

import { expect, test } from '../../support/fixtures.js'
import { consumer } from '../../support/selectors.js'
import { publicNodes, type PublicNode } from '../../support/test-data.js'

/**
 * Mirrors `GOING_PUBLIC_THRESHOLD` in
 * `packages/shared/constants/attribution.ts`. This package is standalone (not in
 * the pnpm workspace) so it cannot import it; the value is fixed by
 * `docs/decisions/proof-of-demand.md` Decision 3 and is the contract under test.
 */
const GOING_PUBLIC_THRESHOLD = 3

/** The two headings the Tonight block is allowed to use (R8.8). */
const TONIGHT_HEADINGS = /^(expected tonight|in the room now)$/i

/** Venues on the consumer map, or an empty list when the city read failed. */
async function mapVenues(anonApiClient: () => Promise<APIRequestContext>): Promise<PublicNode[]> {
  const api = await anonApiClient()
  return await publicNodes(api)
}

function withTonight(nodes: PublicNode[]): PublicNode | undefined {
  return nodes.find((n) => n.slug && n.tonight != null && n.tonight.headline !== '')
}

/**
 * Land on `venue` as the Active_Venue in Browse_Mode. The deep link is the one
 * deterministic way to choose which venue leads the strip (Mapbox is
 * canvas-driven, so tapping a marker is not reliable).
 */
async function landOn(page: Page, venue: PublicNode): Promise<void> {
  await page.goto(`/node/${venue.slug}`)
  await expect(consumer.map(page)).toBeVisible({ timeout: 25_000 })
  await expect(consumer.peekCarousel(page)).toBeVisible({ timeout: 25_000 })
  await expect(consumer.activeVenueCard(page)).toHaveAttribute('data-venue-card', venue.id, { timeout: 20_000 })
}

/** Browse_Mode -> Commit_Mode via the one control allowed to open details. */
async function openDetails(page: Page): Promise<void> {
  await consumer.viewDetails(page).click()
  await expect(consumer.peekCarousel(page)).toHaveAttribute('data-mode', 'commit')
}

test.describe('Consumer — Tonight on the card and the detail (proof-of-demand R8)', () => {
  test('a published night renders one Tonight line on the venue card', async ({ page, anonApiClient }) => {
    const venue = withTonight(await mapVenues(anonApiClient))
    if (!venue?.tonight) {
      test.skip(true, 'No venue on the map has a Tonight — run the proof-of-demand seed to enable this test')
      return
    }

    await landOn(page, venue)

    const line = consumer.cardTonightLine(page, venue.id)
    // Exactly one line, inside the active card: Tonight is additional pull, not
    // a second card section (R8.6).
    await expect(line).toHaveCount(1)
    await expect(line).toContainText(venue.tonight.headline)
    if (venue.tonight.startsAt) await expect(line).toContainText(venue.tonight.startsAt)
  })

  test('a venue with nothing published renders no Tonight line', async ({ page, anonApiClient }) => {
    const venue = (await mapVenues(anonApiClient)).find(
      (n) => n.slug && (n.tonight === null || n.tonight === undefined),
    )
    if (!venue) {
      test.skip(true, 'Every venue on the map has a Tonight — nothing to assert the absence against')
      return
    }

    await landOn(page, venue)

    // No placeholder and no "quiet tonight" invention (`honest-presence.md`).
    await expect(consumer.cardTonightLine(page, venue.id)).toHaveCount(0)
    await openDetails(page)
    await expect(consumer.tonightBlock(page, venue.id)).toHaveCount(0)
    // The Going control is still offered: intent is real without a published
    // night (R9.2).
    await expect(consumer.goingControl(page, venue.id)).toBeVisible()
  })

  test('the detail block shows the headline and the start under an under-claiming heading', async ({
    page,
    anonApiClient,
  }) => {
    const venue = withTonight(await mapVenues(anonApiClient))
    if (!venue?.tonight) {
      test.skip(true, 'No venue on the map has a Tonight — run the proof-of-demand seed to enable this test')
      return
    }

    await landOn(page, venue)
    await openDetails(page)

    const block = consumer.tonightBlock(page, venue.id)
    await expect(block).toBeVisible({ timeout: 15_000 })
    await expect(consumer.tonightHeadline(page)).toHaveText(venue.tonight.headline)
    if (venue.tonight.startsAt) await expect(consumer.tonightStarts(page)).toContainText(venue.tonight.startsAt)
    if (venue.tonight.rewardTitle) await expect(consumer.tonightGet(page)).toContainText(venue.tonight.rewardTitle)

    // The heading may only be one of the two reviewed strings. Anything else
    // would be a crowd claim the Presence_Floor did not authorise (R8.8).
    await expect(block.getByRole('heading')).toHaveText(TONIGHT_HEADINGS)
  })
})

test.describe('Consumer — Going: intent before doors (proof-of-demand R9)', () => {
  test('the toggle records intent and withdraws it, worded as "marked going"', async ({
    page,
    loginAs,
    anonApiClient,
  }) => {
    const venue = withTonight(await mapVenues(anonApiClient))
    if (!venue) {
      test.skip(true, 'No venue on the map has a Tonight — run the proof-of-demand seed to enable this test')
      return
    }

    await loginAs('consumerA', 'consumer')
    await landOn(page, venue)
    await openDetails(page)

    const toggle = consumer.goingToggle(page)
    await expect(toggle).toBeVisible({ timeout: 15_000 })

    // Start from a known state: this account may have marked on a previous run,
    // and the mark is per night, so withdraw first if it is already set.
    if ((await toggle.getAttribute('aria-pressed')) === 'true') {
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 })
    }
    await expect(toggle).toHaveAccessibleName(/mark going tonight|be the first to mark going/i)

    // Mark. One tap is the whole interaction.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
    await expect(toggle).toHaveAccessibleName(/marked going tonight/i)
    // Never "coming", "will arrive" or anything that reads as presence (R9.3).
    await expect(toggle).not.toHaveAccessibleName(/coming|will arrive|attending|here now/i)

    // Withdraw, so the seeded counts other assertions read stay where they were.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 })
  })

  test('a count is named only at or above the threshold', async ({ page, anonApiClient }) => {
    // Read logged out on purpose: the count then comes from the shared city
    // payload alone, so the assertion is deterministic and no mark is written.
    // Margins (>= threshold + 1, <= threshold - 2) keep the branch stable even
    // if another project's toggle test moves a count by one.
    const nodes = await mapVenues(anonApiClient)
    const named = nodes.find((n) => n.slug && n.tonight != null && (n.goingCount ?? 0) >= GOING_PUBLIC_THRESHOLD + 1)
    if (!named) {
      test.skip(
        true,
        `No venue with a Tonight and ${GOING_PUBLIC_THRESHOLD + 1}+ Going marks — the seed's Kudu Bar (5) enables this`,
      )
      return
    }

    await landOn(page, named)
    await openDetails(page)

    const count = consumer.goingCount(page)
    await expect(count).toHaveCount(1)
    await expect(count).toContainText(String(named.goingCount))
    await expect(count).toContainText(/marked going tonight/i)
  })

  test('nothing is said about a count below the threshold', async ({ page, anonApiClient }) => {
    const nodes = await mapVenues(anonApiClient)
    const quiet = nodes.find(
      (n) =>
        n.slug && n.tonight != null && typeof n.goingCount === 'number' && n.goingCount <= GOING_PUBLIC_THRESHOLD - 2,
    )
    if (!quiet) {
      test.skip(
        true,
        `No venue with a Tonight and at most ${GOING_PUBLIC_THRESHOLD - 2} Going marks — the seed's Loft 46 (0) enables this`,
      )
      return
    }

    await landOn(page, quiet)
    await openDetails(page)

    // One or two marks read as empty rather than as momentum (R9.2), and the
    // control is still offered.
    await expect(consumer.goingControl(page, quiet.id)).toBeVisible({ timeout: 15_000 })
    await expect(consumer.goingCount(page)).toHaveCount(0)
  })

  test('logged out, the control asks for sign-in instead of recording intent', async ({ page, anonApiClient }) => {
    const venue = withTonight(await mapVenues(anonApiClient))
    if (!venue) {
      test.skip(true, 'No venue on the map has a Tonight — run the proof-of-demand seed to enable this test')
      return
    }

    await landOn(page, venue)
    await openDetails(page)

    const toggle = consumer.goingToggle(page)
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    await toggle.click()

    // The map's one auth entry, and it stays email + Google only (no-SMS rule).
    await expect(consumer.signInSheet(page)).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('input[type="tel"]')).toHaveCount(0)
    // Nothing was recorded: the mark is still unset behind the sheet.
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })
})
