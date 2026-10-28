import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState, waitForAppIdle } from './helpers/sysgrid'
import { expectHealthyShell, expectNoAppFailures, installStrictAppMonitoring } from './helpers/sentinel'

test.describe('View empty states', () => {
  test('renders explicit empty-state guidance for deterministic no-result filters', async ({ page }) => {
    await resetBrowserState(page)
    const failures = installStrictAppMonitoring(page)
    const impossibleTerm = `PW-NO-MATCH-${Date.now()}`

    const expectations = [
      { path: '/knowledge', placeholder: 'Query Matrix...', text: 'No Intelligence Found' },
      { path: '/racks', placeholder: 'Search racks & devices...', text: `No results for "${impossibleTerm}"` },
    ]

    for (const entry of expectations) {
      await page.goto(entry.path)
      await waitForAppIdle(page)
      await page.getByPlaceholder(entry.placeholder).fill(impossibleTerm)
      await page.keyboard.press('Enter').catch(() => {})
      await expect(page.getByText(entry.text)).toBeVisible()
      await expectHealthyShell(page)
    }

    await expectNoAppFailures(failures, 'empty-state matrix')
  })
})
