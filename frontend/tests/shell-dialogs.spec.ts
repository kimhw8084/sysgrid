import { expect, type Locator } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

async function expectContained(dialog: Locator, width: number, height: number) {
  const panel = dialog.locator(':scope > :first-child')
  const box = await panel.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(height)
  expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2)
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  test(`shell dialogs preserve readable content, focus and recovery in ${theme}`, async ({ page, sysApi }, testInfo) => {
    await resetBrowserState(page)
    await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const trigger = page.getByRole('button', { name: 'Patch Notes', exact: true })
    await trigger.click()
    const notes = page.getByRole('dialog', { name: 'Registry Updates', exact: true })
    await expect(notes).toBeVisible()
    await expectContained(notes, 1280, 720)
    await expectReadableGridText(page, testInfo, `patch-notes-${theme}`, '[role="dialog"]')
    const sections = notes.getByRole('button', { expanded: true })
    await expect(sections).toHaveCount(1)
    await sections.click()
    await expect(notes.getByRole('button', { expanded: true })).toHaveCount(0)
    await notes.getByRole('button', { expanded: false }).first().click()
    await page.setViewportSize({ width: 390, height: 600 })
    await expectContained(notes, 390, 600)
    await page.screenshot({ path: testInfo.outputPath('patch-notes-phone.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(notes).not.toBeVisible()
    await expect(trigger).toBeFocused()
    // The patch-notes opener also remains available on small screens.
    await trigger.click()
    await expect(notes).toBeVisible()
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 1280, height: 720 })
    let unavailable = true
    await page.route('**/api/v1/settings/user/env-vars', route => route.fulfill({
      status: unavailable ? 503 : 200, contentType: 'application/json',
      body: JSON.stringify(unavailable ? { detail: 'Diagnostics temporarily unavailable' } : {
        USER_ID: 'authorized-fixture-user', ACCESS_TOKEN: '********',
        LONG_RUNTIME_LABEL: 'A long environment value that must remain readable without horizontal clipping. '.repeat(8),
      }),
    }))
    const environmentTrigger = page.getByRole('button', { name: 'Open environment details', exact: true })
    await environmentTrigger.click()
    const environment = page.getByRole('dialog', { name: 'Environment details', exact: true })
    await expect(environment.getByRole('alert')).toContainText('Environment details could not be loaded.')
    await expect(page.locator('[data-workspace-toast][data-visible="true"]').filter({ hasText: 'Diagnostics temporarily unavailable' })).toHaveCount(0)
    await expectReadableGridText(page, testInfo, `environment-error-${theme}`, '[role="dialog"]')
    unavailable = false
    await environment.getByRole('button', { name: 'Retry environment details', exact: true }).click()
    await expect(environment.getByText('authorized-fixture-user', { exact: true })).toBeVisible()
    await expect(environment.getByRole('alert')).toHaveCount(0)
    await expectReadableGridText(page, testInfo, `environment-values-${theme}`, '[role="dialog"]')
    await page.setViewportSize({ width: 390, height: 600 })
    await expectContained(environment, 390, 600)
    await page.screenshot({ path: testInfo.outputPath('environment-phone.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.keyboard.press('Escape')
    await expect(environment).not.toBeVisible()
    await expect(environmentTrigger).toBeFocused()
  })
}
