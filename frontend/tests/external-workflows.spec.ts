import { clickResilientButton } from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import { createAsset, createExternalEntity, resetBrowserState } from './helpers/sysgrid'

test.describe('External workflows', () => {
  test('matches the workspace shell contract and opens the shared import modal', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const externalEntity = await createExternalEntity(request, {
      name: `PW-EXT-SHELL-${stamp}`,
      external_key: `pw-ext-shell-${stamp}`.toLowerCase(),
      type: 'API',
      owner_organization: 'PartnerCo',
      ownership_mode: 'individual',
      status: 'Active',
      environment: 'Production',
      description: 'Shell parity coverage entity',
      contacts_json: [
        {
          role: 'Primary',
          full_name: 'Jane Doe',
          external_person_id: `JD-${stamp}`,
          email: 'jane.doe@example.com',
          phone: '+1-555-0101',
          is_primary: true,
          is_escalation: false,
        }
      ],
      business_purpose: 'Workspace shell regression',
      metadata_json: { version: 'v1' }
    })

    await page.goto('/external')
    await expect(page.getByRole('heading', { name: 'External' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Views' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Display' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Activity' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Compare' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bulk Actions' })).toBeVisible()

    await clickResilientButton(page, /Import/i)
    const importModal = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'External Registry Import' }) })
    await expect(importModal).toBeVisible()
    await expect(importModal).toContainText('External Registry')
    await expect(importModal).toContainText('external_entities')
    await page.keyboard.press('Escape')
  })

  test('preserves metadata, supports credentials, and surfaces link failures clearly', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const internalAsset = await createAsset(request, {
      name: `PW-EXT-DEV-${stamp}`,
      system: `PW-EXT-SYS-${stamp}`,
      status: 'Active',
      model: 'R650',
      type: 'Physical',
      serial_number: `PW-EXT-SN-${stamp}`,
      asset_tag: `PW-EXT-TAG-${stamp}`,
      owner: 'external-owner',
      business_unit: 'Operations'
    })
    const externalEntity = await createExternalEntity(request, {
      name: `PW-EXT-${stamp}`,
      external_key: `pw-ext-${stamp}`.toLowerCase(),
      type: 'API',
      owner_organization: 'PartnerCo',
      owner_team: 'B2B',
      ownership_mode: 'individual',
      status: 'Active',
      environment: 'Production',
      description: 'Playwright external integration',
      contacts_json: [
        {
          role: 'Primary',
          full_name: 'Jane Doe',
          external_person_id: `JD-${stamp}`,
          email: 'jane.doe@example.com',
          phone: '+1-555-0101',
          is_primary: true,
          is_escalation: false,
        }
      ],
      business_purpose: 'Customer event ingestion',
      metadata_json: { version: 'v1', custom_note: 'retain-me' }
    })

    await page.goto(`/external?id=${externalEntity.id}`)
    await expect(page.getByRole('heading', { name: 'External' })).toBeVisible()
    const detailsPanel = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: externalEntity.name }) })
    await expect(page.getByText('Mission Summary')).toBeVisible()
    await expect(detailsPanel).toContainText('Customer event ingestion')
    await expect(page.getByText('Dependency Matrix')).toBeVisible()
    await expect(page.getByText('Contact Matrix')).toBeVisible()

    await page.getByPlaceholder('Partner production token').fill(`Partner token ${stamp}`)
    await page.getByPlaceholder('E.G. ADMIN_SVC').fill(`svc_${stamp}`)
    await page.getByPlaceholder('vault://partner/prod/token').fill(`vault://partner/${stamp}/token`)
    await page.getByPlaceholder('Readonly feed access').fill('Readonly feed access')
    await clickResilientButton(page, /Register Credential Reference/i)
    await expect(page.getByText('Credential Added')).toBeVisible()
    await expect(detailsPanel.locator('section').filter({ hasText: 'Credentials' }).getByRole('paragraph').filter({ hasText: `Partner token ${stamp}` })).toBeVisible()
    await expect(page.getByText(`vault://partner/${stamp}/token`)).toBeVisible()

    await expect(detailsPanel.getByRole('paragraph').filter({ hasText: 'Jane Doe' })).toBeVisible()
    await detailsPanel.getByRole('button', { name: 'Edit', exact: true }).last().click()
    const editModal = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Modify External Identity' }) })
    await editModal.locator('select').first().selectOption('Virtual Server')
    await expect(editModal.locator('input[value="hypervisor"]')).toBeVisible()
    await editModal.getByText('Close', { exact: true }).evaluate((node: HTMLElement) => node.click())
    await clickResilientButton(page, 'Discard Changes')

    await page.goto(`/external?id=${externalEntity.id}`)
    await expect(page.getByText('Mission Summary')).toBeVisible()

    await page.route(/\/api\/v1\/intelligence\/links/, async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Simulated interconnect failure' })
        })
      } else {
        await route.continue()
      }
    })
    await expect(page.getByRole('button', { name: /Map Link/i })).toBeVisible()
    await clickResilientButton(page, 'Map Link')
    const linkModal = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Establish External Link' }) })
    await expect(linkModal.locator('select').first()).toContainText(externalEntity.name)
    await linkModal.locator('select').first().selectOption(String(externalEntity.id))
    await linkModal.locator('select').nth(2).selectOption(String(internalAsset.id))
    await linkModal.getByPlaceholder('e.g., Daily DB Synchronization Feed').fill('Partner feed ingress')
    await clickResilientButton(page, /Save Link/i)
    const failureToast = page.locator('[data-workspace-toast="error"]')
    await expect(failureToast).toContainText('Simulated interconnect failure')
    const toastBounds = await failureToast.boundingBox()
    const viewport = page.viewportSize()
    expect(toastBounds).not.toBeNull()
    expect(toastBounds!.y).toBeLessThanOrEqual(24)
    expect(toastBounds!.x + toastBounds!.width).toBeLessThanOrEqual((viewport?.width || 0) - 12)
    await expect(page.getByRole('heading', { name: 'Establish External Link' })).toBeVisible()
    await linkModal.getByText('Close', { exact: true }).click()
    await clickResilientButton(page, 'Discard Changes')

    await page.goto(`/external?id=${externalEntity.id}`)
    await expect(page.getByText('Mission Summary')).toBeVisible()

    await page.unroute(/\/api\/v1\/intelligence\/links/)
    await expect(page.getByRole('button', { name: /Map Link/i })).toBeVisible()
    await clickResilientButton(page, 'Map Link')
    const successLinkModal = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Establish External Link' }) })
    await expect(successLinkModal.locator('select').first()).toContainText(externalEntity.name)
    await successLinkModal.locator('select').first().selectOption(String(externalEntity.id))
    await successLinkModal.locator('select').nth(2).selectOption(String(internalAsset.id))
    await successLinkModal.getByPlaceholder('e.g., Daily DB Synchronization Feed').fill('Partner feed ingress')
    await clickResilientButton(page, /Save Link/i)

    await page.goto(`/external?id=${externalEntity.id}`)
    await expect(page.getByText('Dependency Matrix')).toBeVisible()
    await expect(page.getByText(internalAsset.name)).toBeVisible()
  })
})


test.describe('External desktop column readability', () => {
  for (const theme of ['Dark', 'Light'] as const) {
    test(`keeps default column headings readable in ${theme} theme`, async ({ page, sysApi: request }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await resetBrowserState(page)
      await createExternalEntity(request, { name: `PW-EXT-HEADERS-${Date.now()}`, type: 'API', status: 'Active', environment: 'Production' })
      await page.goto('/external')
      await expect(page.getByRole('heading', { name: 'External' })).toBeVisible()
      await page.getByRole('button', { name: theme, exact: true }).click()
      for (const field of ['business_purpose', 'link_count']) {
        const columnReady = await page.evaluate((columnId) => {
          const api = (window as any).__DEBUG_OPERATIONAL_GRID_API__
          const column = api?.getColumn?.(columnId)
          if (!column?.isVisible?.()) return false
          api.ensureColumnVisible(columnId, 'middle')
          return true
        }, field)
        expect(columnReady, `${field} should be enabled in the default External view`).toBe(true)
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        const text = page.locator(`.ag-header-cell[col-id="${field}"] .ag-header-cell-text`).first()
        await expect(text).toBeVisible()
        await expect.poll(() => text.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      }
    })
  }
})
