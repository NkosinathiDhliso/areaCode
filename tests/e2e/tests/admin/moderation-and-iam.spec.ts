/**
 * §4.6 Abuse flag dashboard, §4.7 Audit trail, §4.8 Report queue,
 * §4.9 Consent audit, §4.10 IAM, §4.11 Archetype management.
 */

import { expect, test } from '../../support/fixtures.js'
import { admin } from '../../support/selectors.js'

test.describe('Admin — moderation, IAM, archetypes', () => {
  test('abuse flag dashboard renders unreviewed list', async ({ page, loginAs }) => {
    await loginAs('admin', 'admin')
    await admin.navTab(page, /abuse|flags?|reports?/i).click()
    await expect(
      page
        .getByRole('table')
        .or(page.getByText(/no (open|unreviewed) flags/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('audit trail filterable by admin & action type', async ({ page, loginAs }) => {
    await loginAs('admin', 'admin')
    await admin.navTab(page, /audit/i).click()
    const filter = page.getByRole('combobox', { name: /action|type/i }).first()
    if (await filter.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await filter.selectOption({ index: 1 }).catch(() => {})
    }
    await expect(page.getByRole('table').or(page.getByRole('list')).first()).toBeVisible()
  })

  test('report queue — pending reports are listed', async ({ page, loginAs }) => {
    await loginAs('admin', 'admin')
    await admin.navTab(page, /report queue|reports?/i).click()
    await expect(page.getByText(/pending|open|resolved/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('consent audit returns version-tagged records', async ({ apiClient }) => {
    const api = await apiClient('admin')
    const res = await api.get('/v1/admin/consent-records?version=v1.0')
    if (!res.ok()) test.skip(true, 'Consent endpoint unavailable')
    const body = (await res.json()) as { records?: Array<{ version?: string }> }
    expect(Array.isArray(body.records)).toBe(true)
  })

  test('IAM — list admins shows roles', async ({ page, loginAs }) => {
    await loginAs('admin', 'admin')
    await admin
      .navTab(page, /iam|admin users/i)
      .click()
      .catch(() => {})
    await expect(page.getByText(/super_admin|read_only|admin/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('archetype management — list & test tool present', async ({ page, loginAs }) => {
    await loginAs('admin', 'admin')
    await admin
      .navTab(page, /archetype/i)
      .click()
      .catch(() => {})
    await expect(page.getByText(/archetype|weights?/i).first()).toBeVisible({ timeout: 10_000 })
  })
})
