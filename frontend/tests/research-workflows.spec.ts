import { clickResilientButton } from './helpers/sysgrid';
import { expect, type Page } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import { createInvestigation, resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

async function getTypedRecordRow(page: Page, title: string, type: 'Research' | 'RCA') {
  const workspace = page.locator('[data-workspace="research"]')
  const centerRow = workspace.locator('.ag-center-cols-container .ag-row').filter({ hasText: title }).filter({ hasText: type })
  await expect(centerRow, `Expected ${type} row for "${title}"`).toBeVisible()
  const rowIndex = await centerRow.getAttribute('row-index')
  if (rowIndex === null) throw new Error(`${type} row for "${title}" is missing row-index`)
  const actionRow = workspace.locator(`.ag-pinned-right-cols-container .ag-row[row-index="${rowIndex}"]`)
  return {
    center: centerRow,
    inspect: actionRow.getByTitle('Inspect Record'),
    archive: actionRow.getByTitle(`Archive ${type}`),
  }
}

test.describe('Research workflows', () => {
  test('filters by real years and rejects blank intelligence pulses', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const research2037 = await createInvestigation(request, {
      title: `PW-RESEARCH-A-${stamp}`,
      status: 'ANALYZING',
      priority: 'HIGH',
      systems: [`PW-SYS-A-${stamp}`],
      initiation_at: '2037-02-03T04:05:00'
    })

    await createInvestigation(request, {
      title: `PW-RESEARCH-B-${stamp}`,
      status: 'OPEN',
      priority: 'LOW',
      systems: [`PW-SYS-B-${stamp}`],
      initiation_at: '2038-06-07T08:09:00'
    })

    const rcaTitle = `PW-RCA-${stamp}`
    const rcaResponse = await request.post(`${apiBase}/rca`, {
      headers: { 'X-User-Id': process.env.USER_ID || 'haewon.kim', 'X-Tenant-Id': '1' },
      data: {
        title: rcaTitle,
        problem_statement: 'Type-specific RCA detail validation',
        priority: 7,
        status: 'Open',
        severity: 'High',
        incident_type: 'Operational',
        target_systems: [`PW-RCA-SYS-${stamp}`],
        occurrence_at: '2037-03-04T05:06:00'
      }
    })
    expect(rcaResponse.ok()).toBeTruthy()

    await page.goto('/research')
    const workspace = page.locator('[data-workspace="research"]')
    await expect(workspace).toBeVisible()
    await expect(workspace.getByRole('heading', { name: 'Research Matrix' })).toBeVisible()
    await expect(workspace.getByRole('button', { name: /Display/i })).toBeVisible()
    await expect(workspace.getByRole('button', { name: /Filters/i })).toBeVisible()
    await expect(workspace.getByRole('button', { name: /Insights/i })).toBeVisible()
    await expect(workspace.getByTitle('Export CSV')).toBeVisible()
    await expect(workspace.getByRole('button', { name: 'Add Research' })).toBeVisible()
    await expect(workspace.getByText(/mixed records/i)).toHaveCount(0)
    await expect(workspace.getByText('Total Intelligence')).not.toBeVisible()
    await expect(workspace.getByRole('treegrid')).toBeVisible()
    await expect(page.getByRole('button', { name: '2037' })).not.toBeVisible()
    await workspace.getByRole('button', { name: /Filters/i }).click()
    await expect(page.getByRole('button', { name: '2037' })).toBeVisible()
    await expect(page.getByRole('button', { name: '2038' })).toBeVisible()

    await clickResilientButton(page, '2037')
    await page.getByPlaceholder('SCAN RESEARCH...').fill(research2037.title)
    const researchRow = await getTypedRecordRow(page, research2037.title, 'Research')
    await expect(researchRow.center).toContainText('Research')

    await researchRow.inspect.click()
    await expect(page).toHaveURL(new RegExp(`/research\\?type=research&id=${research2037.id}$`))
    await expect(page.getByRole('heading', { name: research2037.title, exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: research2037.title, exact: true })).toBeVisible()
    const intelligenceTab = page.getByRole('button', { name: 'Intelligence Stream', exact: true })
    await expect(intelligenceTab).toBeVisible()
    await intelligenceTab.click()
    await clickResilientButton(page, /Record Intelligence/i)
    const pulseErrorToast = page.locator('[data-workspace-toast="error"][data-visible="true"]').filter({ hasText: 'Intelligence pulse text is required' })
    await expect(pulseErrorToast).toHaveCount(1)
    await expect(pulseErrorToast).toBeVisible()

    const pulseText = `Validated intelligence pulse ${stamp}`
    await page.getByPlaceholder('Capture logical system findings...').fill(pulseText)
    await clickResilientButton(page, /Record Intelligence/i)
    await expect(page.getByText(pulseText, { exact: true })).toBeVisible()

    await page.goto('/research')
    await page.getByPlaceholder('SCAN RESEARCH...').fill(rcaTitle)
    const rcaRow = await getTypedRecordRow(page, rcaTitle, 'RCA')
    await expect(rcaRow.center).toContainText('RCA')
    await rcaRow.inspect.click()
    const rcaPayload = await rcaResponse.json()
    await expect(page).toHaveURL(new RegExp(`/research\\?type=rca&id=${rcaPayload.id}$`))
    await expect(page.getByRole('heading', { name: rcaTitle, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enter Edit Mode' })).toBeVisible()
    await expect(page.getByText('RCA', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(research2037.title, { exact: true })).not.toBeVisible()

    await page.goto('/research')
    await page.getByPlaceholder('SCAN RESEARCH...').fill(rcaTitle)
    const archiveRow = await getTypedRecordRow(page, rcaTitle, 'RCA')
    await archiveRow.archive.click()
    await expect(page.getByRole('heading', { name: 'Archive RCA' })).toBeVisible()
    const archiveDialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Archive RCA' }) })
    await archiveDialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(archiveRow.center).toBeVisible()
  })
})
