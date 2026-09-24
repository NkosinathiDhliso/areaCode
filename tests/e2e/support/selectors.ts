/**
 * Centralised selectors used across specs.
 *
 * Prefer `data-testid` once the apps adopt them. Until then, fall back
 * to role + accessible name + text patterns. Update here, never inline,
 * so a UI rename only needs one change.
 *
 * See `tests/e2e/TESTID_AUDIT.md` for the testids the apps should expose.
 */

import type { Page, Locator } from '@playwright/test'

const oneOf =
  (...selectors: string[]) =>
  (page: Page): Locator =>
    page.locator(selectors.join(', ')).first()

export const consumer = {
  map: oneOf('[data-testid="consumer-map"]', '.mapboxgl-map', 'canvas'),
  searchBox: (page: Page) =>
    page
      .getByTestId('consumer-search')
      .or(page.getByRole('searchbox'))
      .or(page.getByPlaceholder(/search/i))
      .first(),
  noResults: (page: Page) => page.getByText(/no (results|venues|matches)/i).first(),
  checkInButton: (page: Page) => page.getByRole('button', { name: /check.?in/i }).first(),
  cooldownToast: (page: Page) => page.getByText(/cooldown|already checked in|wait/i).first(),
  tierBadge: (page: Page) =>
    page
      .getByTestId('tier-badge')
      .or(page.getByText(/local|insider|patron|icon|legend/i))
      .first(),
  profileLink: (page: Page) =>
    page
      .getByRole('link', { name: /profile|me/i })
      .or(page.getByRole('button', { name: /profile|me/i }))
      .first(),
  rewardsTab: (page: Page) =>
    page
      .getByRole('link', { name: /rewards?|gets?/i })
      .or(page.getByRole('tab', { name: /rewards?|gets?/i }))
      .first(),
  privacyToggle: (page: Page) => page.getByRole('radio', { name: /public|friends|private/i }).first(),

  // ── Peek-Carousel (map-discovery-experience) ──
  /** The two-state browse-and-compare host. `data-mode` is browse|commit. */
  peekCarousel: (page: Page) => page.locator('[data-peek-carousel]').first(),
  /** A Browse_Mode venue card; the active one carries aria-pressed="true". */
  venueCard: (page: Page) => page.locator('[data-venue-card]').first(),
  activeVenueCard: (page: Page) => page.locator('[data-venue-card][aria-pressed="true"]').first(),
  /** Keyboard-operable Flick_Controls. */
  flickNext: (page: Page) => page.getByRole('button', { name: /next venue/i }).first(),
  flickPrev: (page: Page) => page.getByRole('button', { name: /previous venue/i }).first(),
  /** Browse_Mode control that expands the sheet into Commit_Mode. */
  viewDetails: (page: Page) => page.getByRole('button', { name: /view details/i }).first(),
  /** Empty-viewport invite shown when no venue is in range. */
  browseEmpty: (page: Page) => page.locator('[data-browse-empty]').first(),

  // ── Tonight and Going (proof-of-demand R8, R9) ──
  /** The one Tonight line on a Browse_Mode card, keyed by venue id. */
  cardTonightLine: (page: Page, nodeId: string) => page.locator(`[data-venue-card-tonight="${nodeId}"]`),
  /** Tonight block on the venue detail (Commit_Mode), keyed by venue id. */
  tonightBlock: (page: Page, nodeId: string) => page.locator(`[data-tonight-block="${nodeId}"]`),
  tonightHeadline: (page: Page) => page.locator('[data-tonight-headline]').first(),
  tonightStarts: (page: Page) => page.locator('[data-tonight-starts]').first(),
  tonightGet: (page: Page) => page.locator('[data-tonight-get]').first(),
  /** The Going control on the venue detail, keyed by venue id. */
  goingControl: (page: Page, nodeId: string) => page.locator(`[data-going-control="${nodeId}"]`),
  goingToggle: (page: Page) => page.locator('[data-going-toggle]').first(),
  /** The "N marked going tonight" line. Absent below the Going_Threshold. */
  goingCount: (page: Page) => page.locator('[data-going-count]'),
  goingReminderOffer: (page: Page) => page.locator('[data-going-reminder-offer]').first(),

  // ── Bottom-nav tabs (consumer shell) ──
  /** A bottom-nav tab button, scoped to the nav so it never matches in-screen buttons. */
  navTab: (page: Page, name: RegExp) =>
    page
      .getByRole('navigation', { name: /main navigation/i })
      .getByRole('button', { name })
      .first(),

  // ── Map-owned portaled sheets (map-carousel scope contract) ──
  // These render through a document.body portal and are gated on the Map tab
  // being active (fix c047c94). They must never be visible on another tab.
  /** Venue search sheet (dialog hosting the search input). */
  searchSheet: (page: Page) =>
    page
      .getByRole('dialog')
      .filter({ has: page.getByPlaceholder(/search/i) })
      .first(),
  /** Sign-in sheet (email/password + Google OAuth entry; no phone/SMS). */
  signInSheet: (page: Page) =>
    page
      .getByRole('dialog')
      .filter({ hasText: /sign in to (check in|continue)/i })
      .first(),
  /** In-app QR scanner sheet. */
  qrScannerSheet: (page: Page) =>
    page
      .getByRole('dialog')
      .filter({ hasText: /scan the venue qr/i })
      .first(),

  // ── BottomSheet portal internals (non-modal Browse contract) ──
  /** The dialog panel that hosts the carousel (the only interactive layer in Browse). */
  sheetPanel: (page: Page) =>
    page
      .getByRole('dialog')
      .filter({ has: page.locator('[data-peek-carousel]') })
      .first(),
  /** The BottomSheet portal wrapper: a direct child of <body> containing the carousel. */
  sheetPortal: (page: Page) => page.locator('body > div:has([data-peek-carousel])').first(),
  /** Modal backdrop sibling (role=presentation). Present only in Commit_Mode. */
  sheetBackdrop: (page: Page) => page.locator('body > div:has([data-peek-carousel]) [role="presentation"]'),
}

/** A business dashboard nav pill, by its panel label. */
const panelNav = (page: Page, name: RegExp): Locator => page.getByRole('button', { name }).first()

export const business = {
  livePanelCount: (page: Page) =>
    page
      .getByTestId('live-checkin-count')
      .or(page.getByText(/check.?ins today/i))
      .first(),
  pulseGauge: (page: Page) => page.getByTestId('pulse-gauge').or(page.getByText(/pulse/i)).first(),
  settingsLink: (page: Page) => page.getByRole('link', { name: /settings/i }).first(),
  rewardsLink: (page: Page) => page.getByRole('link', { name: /rewards?|gets?/i }).first(),
  createRewardButton: (page: Page) => page.getByRole('button', { name: /(create|new) (reward|get)/i }).first(),
  inviteStaffButton: (page: Page) => page.getByRole('button', { name: /invite (staff|team)/i }).first(),
  generateQrButton: (page: Page) => page.getByRole('button', { name: /generate qr/i }).first(),
  // Dashboard nav is state-based (buttons, not links): one pill per panel,
  // labelled with the panel name. One home for reaching a panel.
  panelNav: panelNav,
  // The Plans tab mounts the PlansPanel, which reads any ?status
  // checkout-return param on mount.
  plansNav: (page: Page) => panelNav(page, /^plans$/i),
  // PlansPanel heading ("Plans & Pricing").
  plansTitle: (page: Page) => page.getByRole('heading', { name: /plans/i }).first(),

  // ── proof-of-demand owner surfaces ──
  /** Onboarding_Checklist card (R5.1). Absent once all four flags are true. */
  onboardingChecklist: (page: Page) => page.getByTestId('onboarding-checklist'),
  onboardingChecklistProgress: (page: Page) => page.getByTestId('onboarding-checklist-progress'),
  onboardingRow: (page: Page, step: string) => page.getByTestId(`onboarding-row-${step}`),
  /** The Receipt on the live panel: the two sentences, rendered verbatim (R4.6). */
  liveReceipt: (page: Page) => page.getByTestId('live-receipt'),
  liveReceiptHeadline: (page: Page) => page.getByTestId('live-receipt-headline'),
  liveReceiptWalkIn: (page: Page) => page.getByTestId('live-receipt-walkin'),
  /** Going tonight card, deliberately outside the aliveness row (R9.4, R9.5). */
  liveGoing: (page: Page) => page.getByTestId('live-going'),
  liveGoingFor: (page: Page, nodeId: string) => page.getByTestId(`live-going-${nodeId}`),
  /** The Receipt above the Plans upgrade CTA (R6.2). */
  plansReceipt: (page: Page) => page.getByTestId('plans-receipt'),
  plansReceiptHeadline: (page: Page) => page.getByTestId('plans-receipt-headline'),
  plansReceiptWalkIn: (page: Page) => page.getByTestId('plans-receipt-walkin'),
  plansReceiptNextStep: (page: Page) => page.getByTestId('plans-receipt-nextstep'),
  plansReceiptLoading: (page: Page) => page.getByTestId('plans-receipt-loading'),
  plansReceiptError: (page: Page) => page.getByTestId('plans-receipt-error'),
  /** Boost_Scoreboard card for one purchase (R7.4). */
  boostScoreboard: (page: Page, boostId: string) => page.getByTestId(`boost-scoreboard-${boostId}`),
  boostScoreboardWindow: (page: Page, boostId: string) => page.getByTestId(`boost-scoreboard-window-${boostId}`),
  boostScoreboardBaseline: (page: Page, boostId: string) => page.getByTestId(`boost-scoreboard-baseline-${boostId}`),
  boostScoreboardDelta: (page: Page, boostId: string) => page.getByTestId(`boost-scoreboard-delta-${boostId}`),
  boostScoreboardNoCompare: (page: Page, boostId: string) => page.getByTestId(`boost-scoreboard-nocompare-${boostId}`),
  /** Found_You source badge on a check-in row (R4.4). Never rendered for a walk-in. */
  foundViaBadge: (page: Page, foundVia: string) => page.getByTestId(`found-via-badge-${foundVia}`),
  /** Tonight publish form (R8.1 to R8.4). */
  tonightPanel: (page: Page) => page.getByTestId('tonight-panel'),
  tonightDate: (page: Page) => page.getByTestId('tonight-date'),
  tonightStart: (page: Page) => page.getByTestId('tonight-start'),
  tonightHeadlineField: (page: Page) => page.getByTestId('tonight-headline'),
  tonightHeadlineCount: (page: Page) => page.getByTestId('tonight-headline-count'),
  tonightSubmit: (page: Page) => page.getByTestId('tonight-submit'),
  tonightNoVenue: (page: Page) => page.getByTestId('tonight-no-venue'),
  tonightDenied: (page: Page) => page.getByTestId('tonight-denied'),
  tonightLoadError: (page: Page) => page.getByTestId('tonight-load-error'),
}

export const staff = {
  scanQrButton: (page: Page) => page.getByRole('button', { name: /scan qr/i }).first(),
  manualEntryInput: (page: Page) =>
    page
      .getByLabel(/code/i)
      .or(page.getByPlaceholder(/enter code/i))
      .first(),
  confirmButton: (page: Page) => page.getByRole('button', { name: /^(confirm|redeem)$/i }).first(),
  cancelButton: (page: Page) => page.getByRole('button', { name: /cancel/i }).first(),
  recentList: (page: Page) =>
    page
      .getByTestId('recent-redemptions')
      .or(page.getByText(/recent redemptions/i))
      .first(),
}

export const admin = {
  navTab: (page: Page, name: RegExp) => page.getByRole('link', { name }).or(page.getByRole('tab', { name })).first(),
  totalConsumers: (page: Page) =>
    page
      .getByTestId('admin-total-consumers')
      .or(page.getByText(/total consumers/i))
      .first(),
  totalBusinesses: (page: Page) =>
    page
      .getByTestId('admin-total-businesses')
      .or(page.getByText(/total businesses/i))
      .first(),
  unreviewedFlagsBadge: (page: Page) =>
    page
      .getByTestId('unreviewed-flags-badge')
      .or(page.getByText(/unreviewed|pending/i))
      .first(),
  searchInput: (page: Page) =>
    page
      .getByRole('searchbox')
      .or(page.getByPlaceholder(/search/i))
      .first(),
  disableButton: (page: Page) => page.getByRole('button', { name: /disable/i }).first(),
  confirmDialogConfirm: (page: Page) =>
    page
      .getByRole('dialog')
      .getByRole('button', { name: /confirm|disable|yes/i })
      .first(),
}

export const auth = {
  // The login screens label their inputs with a placeholder (admin adds an
  // sr-only <label> too), so match either. Widened, not forked: one home for
  // the auth fields across all four portals.
  emailField: (page: Page) => page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first(),
  passwordField: (page: Page) =>
    page
      .getByLabel(/password/i)
      .or(page.getByPlaceholder(/^password$/i))
      .first(),
  // "Continue with Google" sits above the email submit on every portal and also
  // matches /continue/i, so exclude it explicitly — the Google flow is manual
  // (headless browsers are blocked) and must never be the submit target.
  submitButton: (page: Page) =>
    page
      .getByRole('button', { name: /(sign in|log in|continue)/i })
      .filter({ hasNotText: /google/i })
      .first(),
  forgotPasswordLink: (page: Page) => page.getByRole('link', { name: /forgot|reset/i }).first(),
  logoutButton: (page: Page) => page.getByRole('button', { name: /log ?out|sign ?out/i }).first(),
}
