import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'

test.describe('Settings Standards reference', () => {
  test('renders the synchronized reference and exercises shared primitives', async ({ page }) => {
    await resetBrowserState(page)
    await page.goto('/settings?tab=standards')

    const reference = page.getByTestId('settings-standards-reference')
    await expect(reference).toBeVisible()
    await expect(page.getByText('Operational Standards Reference')).toBeVisible()
    await expect(page.getByText(/Runtime shared contracts and accepted production workspaces remain authoritative/)).toBeVisible()
    await expect(page.getByText('Page header grammar')).toBeVisible()
    await expect(page.getByRole('button', { name: /Create/ }).first()).toBeVisible()

    for (const section of [
      'Table Standard',
      'Settings View Standard',
      'Gap Standard',
      'Operational Lexicon',
      'Layout & Composition Directives',
      'Notification Standards',
      'Visual Design Tokens',
      'Radius Standards',
      'Iconography Registry',
      'Capability Matrix',
      'Typography & Headers',
      'Interactive Components',
      'Modal Schemas',
      'Empty States',
      'Operational Workspace Contract',
    ]) {
      await expect(reference.getByText(section, { exact: true })).toBeVisible()
    }

    await expect(reference).not.toContainText('v.3.2')
    await expect(reference).not.toContainText('UI SCHEMA v1.4.2')
    await expect(reference).not.toContainText('Golden Radius')
    await expect(reference).not.toContainText('Monitoring-style')
    await reference.locator('#table-standard > button').click()
    await expect(reference).toContainText('Operational records')
    await expect(reference).toContainText('Read-only summaries')
    await expect(reference).toContainText('two highest-frequency actions beside More')
    await expect(reference).toContainText('keyboard-accessible row menu')
    await expect(reference).toContainText('Shift+F10')

    await reference.locator('#modals > button').click()
    await expect(reference).toContainText('WorkspaceModal supplies accessible dialog semantics')

    await reference.locator('[data-modal-size="standard"]').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('standard modal example')
    await dialog.locator('button[title="Close"]').click()
    await expect(dialog).not.toBeVisible()

    await reference.locator('[data-modal-size="workspace"]').click()
    await expect(page.getByRole('dialog')).toContainText('workspace modal example')
    await page.getByRole('dialog').locator('button[title="Close"]').click()
    await expect(page.getByRole('dialog')).not.toBeVisible()

    await reference.locator('[data-modal-size="fullscreen"]').click()
    await expect(page.getByRole('dialog')).toContainText('fullscreen modal example')
    await page.getByRole('dialog').locator('button[title="Close"]').click()
    await expect(page.getByRole('dialog')).not.toBeVisible()

    await reference.locator('#empty-states > button').click()
    await expect(reference.getByText('No reference records')).toBeVisible()
  })
})
