import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'
import { expectReadableGridText } from './helpers/grid-contrast'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const workspaces = [
  { name: 'Monitoring', route: '/monitoring', endpoint: '/api/v1/monitoring' },
  { name: 'Services', route: '/services', endpoint: '/api/v1/logical-services' },
  { name: 'Network', route: '/network', endpoint: '/api/v1/networks/connections' },
]

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const width of [1440, 390]) {
    test(`operational diagnostics are readable and copy truthfully in ${theme} at ${width}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => {
        localStorage.setItem('sysgrid-theme', value)
        const state = { calls: [] as string[], resolve: () => {}, reject: (_error: Error) => {} }
        ;(window as any).__diagnosticClipboard = state
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          writeText: (text: string) => new Promise<void>((resolve, reject) => {
            state.calls.push(text); state.resolve = resolve; state.reject = reject
          }),
        } })
      }, theme)
      const pageErrors: string[] = []
      page.on('pageerror', error => pageErrors.push(error.message))
      const facts = []
      for (const workspace of workspaces) {
        const body = JSON.stringify({ detail: `Controlled ${workspace.name} registry failure. ${'LongDiagnosticValue'.repeat(16)}` })
        const matches = (url: URL) => url.pathname.replace(/\/$/, '') === workspace.endpoint
        await page.route(matches, route => route.fulfill({ status: 503, contentType: 'application/json', body }))
        await page.goto(workspace.route)
        await expect(page.getByRole('heading', { name: workspace.name, exact: true }).first()).toBeVisible()
        if (width < 768) await page.getByRole('button', { name: 'View & filters', exact: true }).click()
        const pill = page.getByRole('button', { name: 'Data error 503', exact: true })
        await expect(pill).toBeVisible()
        await expectReadableGridText(page, testInfo, `${workspace.name}-diagnostic-pill`, 'button:has-text("Data error 503")')
        const pillBounds = await pill.boundingBox()
        expect(pillBounds!.height).toBeGreaterThanOrEqual(44)
        const summary = page.locator('[data-workspace-toast="error"]').filter({ hasText: JSON.parse(body).detail })
        await expect(summary).toBeVisible()
        await pill.focus()
        await page.keyboard.press('Enter')
        const dialog = page.getByRole('dialog', { name: 'Diagnostic Information', exact: true })
        await expect(dialog).toBeVisible()
        // Opening the report consumes this notice immediately, before expiry.
        expect(await summary.count()).toBe(0)
        const copy = dialog.getByRole('button', { name: 'Copy Diagnostics', exact: true })
        await copy.scrollIntoViewIfNeeded()
        await expect(copy).toBeInViewport({ ratio: 1 })
        // The shared modal enters with scale animation; measure its final target.
        await expect.poll(async () => (await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        const copyBounds = await copy.boundingBox()
        expect(copyBounds!.height).toBeGreaterThanOrEqual(44)
        await copy.focus()
        await page.keyboard.press('Enter')
        await expect(copy).toBeDisabled()
        await expect(dialog.getByRole('status')).toHaveText('Copying diagnostics…')
        await expect(dialog.getByText('Diagnostics copied.', { exact: true })).toHaveCount(0)
        const calls = await page.evaluate(() => (window as any).__diagnosticClipboard.calls)
        expect(calls).toHaveLength(1)
        const report = JSON.parse(calls[0])
        expect(report.endpoint).toContain(workspace.endpoint)
        expect(report.status).toBe(503)
        expect(report.rawBody).toBe(body)
        await page.evaluate(() => (window as any).__diagnosticClipboard.reject(new DOMException('Clipboard denied', 'NotAllowedError')))
        await expect(copy).toBeEnabled()
        const failure = dialog.getByRole('alert')
        await expect(failure).toContainText('Could not copy diagnostics.')
        const manual = dialog.getByRole('textbox', { name: 'Diagnostics for manual copy' })
        await expect(manual).toHaveValue(calls[0])
        await manual.focus()
        expect(await manual.evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart)).toBe(calls[0].length)
        await expectReadableGridText(page, testInfo, `${workspace.name}-diagnostic-failure`, '[data-workspace-modal-body]')
        await page.screenshot({ path: testInfo.outputPath(`${workspace.name}-diagnostic-failure.png`), animations: 'disabled' })
        await copy.scrollIntoViewIfNeeded()
        await copy.click()
        await expect(copy).toBeDisabled()
        await page.evaluate(() => (window as any).__diagnosticClipboard.resolve())
        await expect(copy).toBeEnabled()
        await expect(dialog.getByRole('status')).toHaveText('Diagnostics copied.')
        await expect(failure).toHaveCount(0)
        await expect(manual).toHaveCount(0)
        expect(await page.evaluate(() => (window as any).__diagnosticClipboard.calls)).toEqual([calls[0], calls[0]])
        await expectReadableGridText(page, testInfo, `${workspace.name}-diagnostic-success`, '[data-workspace-modal-body]')
        await page.screenshot({ path: testInfo.outputPath(`${workspace.name}-diagnostic-success.png`), animations: 'disabled' })
        const overflow = await dialog.locator('[data-workspace-modal-body]').evaluate(element => element.scrollWidth - element.clientWidth)
        expect(overflow).toBeLessThanOrEqual(2)
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2)
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(pill).toBeFocused()
        facts.push({ workspace: workspace.name, pillBounds, copyBounds, overflow, exactReport: true, deniedThenRetried: true })
        await page.unroute(matches)
      }
      expect(pageErrors).toEqual([])
      await testInfo.attach('diagnostic-facts', { body: JSON.stringify({ theme, width, workspaces: facts, pageErrors }), contentType: 'application/json' })
    })
  }
}
