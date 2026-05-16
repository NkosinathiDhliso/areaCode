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
      .or(page.getByText(/explorer|regular|local|insider/i))
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
}

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
  emailField: (page: Page) => page.getByLabel(/email/i).first(),
  passwordField: (page: Page) => page.getByLabel(/password/i).first(),
  submitButton: (page: Page) => page.getByRole('button', { name: /(sign in|log in|continue)/i }).first(),
  forgotPasswordLink: (page: Page) => page.getByRole('link', { name: /forgot|reset/i }).first(),
  logoutButton: (page: Page) => page.getByRole('button', { name: /log ?out|sign ?out/i }).first(),
}
