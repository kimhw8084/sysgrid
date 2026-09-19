import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { clickResilientButton, openToolbarButton, resetBrowserState, testApiHeaders } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

const workspaces = [
  { key: 'monitoring', route: '/monitoring', heading: 'Monitoring' },
  { key: 'external', route: '/external', heading: 'External' },
  { key: 'services', route: '/services', heading: 'Services' },
] as const

test.describe('Collaborative workspace views', () => {
  test('persists personal views through the backend and restores stable view links', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const selectedWorkspaces = process.env.SYSGRID_VERIFY_PROFILE === 'normal-v1'
      ? workspaces.filter((workspace) => workspace.key !== 'external')
      : workspaces
    for (const workspace of selectedWorkspaces) {
      const name = `PW-${workspace.key.toUpperCase()}-VIEW-${stamp}`
      await page.goto(workspace.route)
      await expect(page.getByRole('heading', { name: workspace.heading, exact: true }).first()).toBeVisible()
      await openToolbarButton(page, 'Views')
      await expect(page.getByTestId('workspace-view-sync-status')).toHaveText('Synced')

      await page.getByPlaceholder('Save as new personal view...').fill(name)
      await clickResilientButton(page, /^Save personal view$/)
      await expect(page.getByRole('button').filter({ hasText: name }).first()).toBeVisible()

      await expect.poll(async () => {
        const response = await request.get(`${apiBase}/workspaces/${workspace.key}/views`, { headers: testApiHeaders })
        if (!response.ok()) return false
        const payload = await response.json()
        return Array.isArray(payload?.views) && payload.views.some((view: any) => view.name === name)
      }).toBeTruthy()
      await expect(page).toHaveURL(/(?:\?|&)view=\d+/)
      await expect(page.getByTestId('workspace-view-sync-status')).toHaveText('Synced')
      await expect(page.getByTitle(`Rename ${name}`)).toBeVisible()

      const renamed = `${name}-RENAMED`
      await page.getByTitle(`Rename ${name}`).click()
      const renameInput = page.getByLabel('Rename personal view')
      const renamePanel = renameInput.locator('xpath=ancestor::*[@data-workspace-panel="true"][1]')
      const confirmRename = page.getByRole('button', { name: `Confirm rename ${name}`, exact: true })
      await renameInput.fill(renamed)
      await expect(renameInput).toHaveValue(renamed)
      await expect(renamePanel).toBeVisible()
      await confirmRename.scrollIntoViewIfNeeded()
      await expect(renamePanel).toBeVisible()
      await expect(renameInput).toHaveValue(renamed)
      await expect(confirmRename).toBeVisible()
      await expect(confirmRename).toBeEnabled()
      const renameRequestPromise = page.waitForRequest((request) => {
        if (request.method() !== 'PUT') return false
        const url = new URL(request.url())
        if (!/\/api\/v1\/workspaces\/views\/\d+$/.test(url.pathname)) return false
        try {
          return request.postDataJSON()?.name === renamed
        } catch {
          return false
        }
      })
      const renameResponsePromise = page.waitForResponse((response) => {
        const request = response.request()
        if (request.method() !== 'PUT') return false
        const url = new URL(request.url())
        if (!/\/api\/v1\/workspaces\/views\/\d+$/.test(url.pathname)) return false
        try {
          return request.postDataJSON()?.name === renamed
        } catch {
          return false
        }
      })
      await confirmRename.click()
      const renameRequest = await renameRequestPromise
      expect(renameRequest.postDataJSON()).toMatchObject({ name: renamed })
      const renameResponse = await renameResponsePromise
      expect(renameResponse.ok()).toBeTruthy()
      await expect(page.getByTestId('workspace-view-sync-status')).toHaveText('Synced')
      await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible()
      await expect.poll(async () => {
        const response = await request.get(`${apiBase}/workspaces/${workspace.key}/views`, { headers: testApiHeaders })
        if (!response.ok()) return false
        const payload = await response.json()
        return Array.isArray(payload?.views) && payload.views.some((view: any) => view.name === renamed)
      }).toBeTruthy()

      await clickResilientButton(page, /^Copy link$/)
      await expect(page).toHaveURL(/(?:\?|&)view=\d+/)
      const viewId = new URL(page.url()).searchParams.get('view')
      expect(viewId).toBeTruthy()

      await page.reload()
      await expect(page.getByRole('heading', { name: workspace.heading, exact: true }).first()).toBeVisible()
      await openToolbarButton(page, 'Views')
      await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible()
      const currentViewSummary = page.getByText('Current view', { exact: true }).locator('..')
      await expect(currentViewSummary.getByText(renamed, { exact: true })).toBeVisible()
      expect(new URL(page.url()).searchParams.get('view')).toBe(viewId)

      const cleanupList = await request.get(`${apiBase}/workspaces/${workspace.key}/views`, { headers: testApiHeaders })
      expect(cleanupList.ok()).toBeTruthy()
      const cleanupRecord = (await cleanupList.json()).views.find((view: any) => view.id === Number(viewId))
      expect(cleanupRecord).toBeTruthy()
      const cleanup = await request.delete(`${apiBase}/workspaces/views/${viewId}?revision=${cleanupRecord.revision}`, { headers: testApiHeaders })
      expect(cleanup.ok()).toBeTruthy()
      await page.keyboard.press('Escape')
    }
  })
})
