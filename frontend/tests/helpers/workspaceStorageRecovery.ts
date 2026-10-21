import { expect, type Page } from '@playwright/test'
import { test } from './sysgrid-test'
import { resetBrowserState } from './sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const notice = 'Browser storage is unavailable. Local preferences may be lost when you reload.'

function installStorageFault(name: string) {
  const state = { enabled: true, failures: 0 }
  ;(window as any).__optionalStorageFault = state
  // Canonical migration markers and identity/tenant bootstrap retain their own
  // policies. Inject faults only into optional preference/cache operations.
  const optional = (key: string) => key === 'sysgrid-theme' || (
    /^sysgrid_(services|monitoring|network|asset|vendor|vendors|projects)_/.test(key) && !key.endsWith('_migrated')
  ) || key === 'sysgrid-permission-team-filters-v1'
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    const original = Storage.prototype[method]
    Storage.prototype[method] = function (key: string, ...args: string[]) {
      if (state.enabled && optional(key) && (name === 'SecurityError' || method !== 'getItem')) {
        state.failures += 1
        throw new DOMException('Injected optional storage failure', name)
      }
      return (original as Function).call(this, key, ...args)
    } as any
  }
}

async function expectTopRightStorageNotice(page: Page) {
  await expect(page.getByText(notice, { exact: true })).toBeVisible()
  await expect(page.getByText(notice, { exact: true })).toHaveCount(1)
  const box = await page.locator('[data-workspace-toaster]').boundingBox()
  expect(box).not.toBeNull()
  const right = page.viewportSize()!.width - box!.x - box!.width
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeLessThanOrEqual(32)
  expect(right).toBeGreaterThanOrEqual(8)
  expect(right).toBeLessThanOrEqual(32)
}

export function registerStorageRecoveryTests(workspaces: Array<{
  route: string; search: string; key: string; serverKey?: string
}>, owners: Array<'sidebar' | 'settings'> = []) {
for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const fault of ['QuotaExceededError', 'SecurityError']) {
    for (const workspace of workspaces) {
      test(`${workspace.route} keeps preferences usable through ${fault} in ${theme}`, async ({ page, sysApi }, testInfo) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await resetBrowserState(page)
        expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
        // Finish normal identity/bootstrap first; the reset token survives the
        // next navigation, so its setup cannot be mistaken for an app failure.
        await page.goto('/')
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await page.waitForLoadState('networkidle')
        await page.addInitScript(installStorageFault, fault)
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(workspace.route)
        const search = page.getByPlaceholder(workspace.search, { exact: true })
        await expect(search).toBeVisible()
        const desired = `Storage recovery ${Date.now()}`
        await search.fill(desired)
        await expect(search).toHaveValue(desired)
        await expect.poll(() => page.evaluate(() => (window as any).__optionalStorageFault.failures)).toBeGreaterThan(0)
        if (workspace.serverKey) {
          await expect.poll(async () => {
            const response = await sysApi.get(`${apiBase}/settings/user/settings`)
            expect(response.ok()).toBeTruthy()
            return (await response.json())[workspace.serverKey!]?.uiState?.searchTerm
          }).toBe(desired)
        }
        await expectTopRightStorageNotice(page)
        expect(await page.evaluate(() => Boolean(localStorage.getItem('SYSGRID_USER_ID')))).toBe(true)
        await page.screenshot({ path: testInfo.outputPath('storage-unavailable.png'), animations: 'disabled' })
        // Storage becomes available without a reload: the existing React state
        // owner persists the next user update, rather than staying disabled.
        await page.evaluate(() => { (window as any).__optionalStorageFault.enabled = false })
        const recovered = `${desired} recovered`
        await search.fill(recovered)
        await expect.poll(() => page.evaluate(key => localStorage.getItem(key), workspace.key)).toContain(recovered)
        expect(errors).toEqual([])
      })
    }

    for (const owner of owners) {
      test(`${owner} theme sync survives ${fault} from ${theme}`, async ({ page, sysApi }, testInfo) => {
        await page.setViewportSize({ width: 1440, height: 900 })
        await resetBrowserState(page)
        expect((await sysApi.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
        await page.goto('/')
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await page.waitForLoadState('networkidle')
        await page.addInitScript(installStorageFault, fault)
        const errors: string[] = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(owner === 'settings' ? '/settings' : '/')
        const next = theme === 'pure-clarity' ? 'nordic-frost-v1' : 'pure-clarity'
        const label = next === 'pure-clarity' ? 'Light Mode' : 'Dark Mode'
        const pending = page.waitForResponse(response => response.url().endsWith('/api/v1/settings/user/settings')
          && response.request().method() === (owner === 'settings' ? 'POST' : 'PATCH') && response.request().postDataJSON()?.theme === next)
        if (owner === 'settings') await page.locator('[data-settings-personal-preferences]').getByRole('button', { name: label.split(' ')[0], exact: true }).click()
        else await page.getByTitle(label, { exact: true }).click()
        expect((await pending).ok()).toBeTruthy()
        await expect(page.locator('html')).toHaveAttribute('data-theme', next)
        expect((await (await sysApi.get(`${apiBase}/settings/user/settings`)).json()).theme).toBe(next)
        await expectTopRightStorageNotice(page)
        expect(errors).toEqual([])
        await page.screenshot({ path: testInfo.outputPath('theme-storage-unavailable.png'), animations: 'disabled' })
      })
    }
  }
}
}
