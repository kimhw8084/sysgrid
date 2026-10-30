import { clickResilientButton } from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import {
  createFarCause,
  createFarMitigation,
  createFarMode,
  createInvestigation,
  resetBrowserState,
  seedOperationalScenario,
  updateFarMode,
} from './helpers/sysgrid'

const farApiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

async function getCurrentFarMode(request: any, modeId: number) {
  const response = await request.get(`${farApiBase}/far/modes?include_deleted=true`)
  expect(response.ok()).toBeTruthy()
  const modes = await response.json()
  const mode = modes.find((candidate: any) => Number(candidate.id) === Number(modeId))
  expect(mode, `Expected FAR mode ${modeId}`).toBeTruthy()
  return mode
}

async function getFarHistory(request: any, modeId: number) {
  const response = await request.get(`${farApiBase}/far/modes/${modeId}/history`)
  expect(response.ok()).toBeTruthy()
  return response.json()
}
test.describe('FAR workflows', () => {
  test('opens deep links and refreshes the wizard when the selected mode changes', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const { systemName, far } = await seedOperationalScenario(request)
    const secondMode = await createFarMode(request, {
      system_name: systemName,
      title: `PW-FAR-ALT-${Date.now()}`,
      effect: 'Alternate failure mode',
      severity: 6,
      occurrence: 2,
      detection: 2,
    })

    await page.goto(`/far?id=${far.id}`)
    await expect(page.locator('[data-workspace="far"]')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/far\\?id=${far.id}$`))
    await expect(page.getByRole('button', { name: /Causal Forensics/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: far.title })).toBeVisible()

    const dossier = page.getByRole('dialog', { name: 'Failure Mode Dossier', exact: true })
    await dossier.getByRole('button', { name: 'Edit failure vector', exact: true }).click()
    const titleInput = page.getByPlaceholder('E.G., DATABASE_CONNECTION_TIMEOUT')
    await expect(titleInput).toHaveValue(far.title)

    await page.evaluate((modeId) => {
      window.history.pushState({}, '', `/far?id=${modeId}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, secondMode.id)
    await expect(titleInput).toHaveValue(secondMode.title)
    await expect(page.getByText('Edit Failure Mode')).toBeVisible()
  })

  test('uses the golden grid and previews failure-vector retirement without changing data', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const { far } = await seedOperationalScenario(request)

    await page.goto('/far')
    const workspace = page.locator('[data-workspace="far"]')
    const gridSurface = workspace.locator('[data-golden-grid-surface="true"]')
    await expect(gridSurface).toBeVisible()
    await expect(workspace.getByRole('button', { name: /Display/i })).toBeVisible()
    await expect(workspace.getByRole('button', { name: /Filters/i })).toBeVisible()
    await expect(workspace.getByRole('button', { name: 'FAR domain tools', exact: true })).toBeVisible()
    await expect(workspace.getByTitle('Export CSV')).toBeVisible()
    await expect(workspace.getByTitle('Copy to Clipboard')).toBeVisible()
    await expect(workspace.getByText(/failure vectors in scope/i)).toHaveCount(0)
    await expect(workspace.getByText('Reliability Index', { exact: true })).not.toBeVisible()
    await workspace.getByRole('button', { name: 'FAR domain tools', exact: true }).click()
    await page.getByRole('button', { name: 'Reliability insights', exact: true }).click()
    await page.getByRole('button', { name: 'Close FAR tools', exact: true }).click()
    await expect(workspace.getByText('Reliability Index', { exact: true })).toBeVisible()
    await workspace.getByRole('button', { name: 'FAR domain tools', exact: true }).click()
    await page.getByRole('button', { name: 'Reliability insights', exact: true }).click()
    await page.getByRole('button', { name: 'Close FAR tools', exact: true }).click()
    await expect(workspace.getByText('Reliability Index', { exact: true })).not.toBeVisible()
    await page.getByPlaceholder(/scan risk vectors/i).fill(far.title)
    const centerRow = workspace.locator('.ag-center-cols-container .ag-row').filter({ hasText: far.title })
    await expect(centerRow).toBeVisible()
    const rowIndex = await centerRow.getAttribute('row-index')
    if (rowIndex === null) throw new Error('FAR row is missing row-index')
    const actionRow = workspace.locator(`.ag-pinned-right-cols-container .ag-row[row-index="${rowIndex}"]`)
    await actionRow.getByTitle('Retire failure vector').click()

    await expect(page.getByRole('heading', { name: 'FAR bulk preview' })).toBeVisible()
    await expect(page.getByText('Retire failure vectors', { exact: true })).toBeVisible()
    await clickResilientButton(page, 'Cancel')
    await expect(centerRow).toBeVisible()
  })

  test('edits mitigation provenance and preserves FAR version history invariants', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const { far } = await seedOperationalScenario(request)
    let current = await getCurrentFarMode(request, far.id)
    const initialVersion = Number(current.version)

    const causeResponse = await request.post(`${farApiBase}/far/causes`, {
      data: {
        mode_id: far.id,
        expected_version: current.version,
        mode_ids: [far.id],
        cause_text: 'Transient dependency fault',
        occurrence_level: 4,
        responsible_team: 'Operations',
      },
    })
    expect(causeResponse.ok()).toBeTruthy()
    const cause = await causeResponse.json()
    current = await getCurrentFarMode(request, far.id)
    expect(Number(current.version)).toBe(initialVersion + 1)

    const bkmTitle = `PW-BKM-${Date.now()}`
    const bkmResponse = await request.post(`${farApiBase}/knowledge`, {
      data: {
        category: 'BKM',
        title: bkmTitle,
        content: 'Focused mitigation runbook',
        status: 'Published',
      },
    })
    expect(bkmResponse.ok()).toBeTruthy()
    const bkm = await bkmResponse.json()

    const externalSteps = 'Use temporary external runbook'
    const externalUrl = 'https://example.com/runbooks/far-mitigation'
    const externalResponse = await request.post(`${farApiBase}/far/mitigations`, {
      data: {
        mode_id: far.id,
        expected_version: current.version,
        mode_ids: [far.id],
        mitigation_type: 'Workaround',
        mitigation_steps: externalSteps,
        responsible_team: 'SRE',
        status: 'Not Started',
        cause_id: cause.id,
        external_bkm_url: externalUrl,
      },
    })
    expect(externalResponse.ok()).toBeTruthy()
    const externalMitigation = await externalResponse.json()
    current = await getCurrentFarMode(request, far.id)
    expect(Number(current.version)).toBe(initialVersion + 2)

    const directSteps = 'Use published direct BKM'
    const directResponse = await request.post(`${farApiBase}/far/mitigations`, {
      data: {
        mode_id: far.id,
        expected_version: current.version,
        mode_ids: [far.id],
        mitigation_type: 'Workaround',
        mitigation_steps: directSteps,
        responsible_team: 'Operations',
        status: 'Not Started',
        cause_id: cause.id,
        knowledge_bkm_id: bkm.id,
      },
    })
    expect(directResponse.ok()).toBeTruthy()
    current = await getCurrentFarMode(request, far.id)
    expect(Number(current.version)).toBe(initialVersion + 3)

    await page.goto(`/far?id=${far.id}`)
    const roadmapTab = page.getByRole('button', { name: /Strategic Roadmap/i })
    await expect(roadmapTab).toBeVisible()
    await roadmapTab.click()

    const externalRow = page.locator('tr', { hasText: externalSteps })
    await expect(externalRow).toContainText('Owner: SRE')
    const externalLink = externalRow.getByRole('link', { name: /External BKM/i })
    await expect(externalLink).toHaveAttribute('href', externalUrl)
    await expect(externalLink).toHaveAttribute('rel', /noopener/)

    const directRow = page.locator('tr', { hasText: directSteps })
    await expect(directRow).toContainText(`Linked BKM: ${bkmTitle}`)

    await externalRow.hover()
    await externalRow.getByTitle('Edit mitigation').click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Edit Workaround' })
    await expect(dialog).toContainText('Edit Workaround')
    const deploymentNarrative = dialog.getByPlaceholder('Describe the deployment protocol...')
    await expect(deploymentNarrative).toHaveValue(externalSteps)
    await dialog.getByPlaceholder('e.g. SRE').fill('Reliability Engineering')
    await dialog.locator('select').first().selectOption('In Progress')
    const saveAction = dialog.getByRole('button', { name: 'Save Strategic Action' })
    await expect(saveAction).toBeEnabled()
    await saveAction.click()

    await expect(externalRow).toContainText('Owner: Reliability Engineering')
    await expect(externalRow).toContainText('IN PROGRESS')
    current = await getCurrentFarMode(request, far.id)
    expect(Number(current.version)).toBe(initialVersion + 4)

    const completedResponse = await request.put(`${farApiBase}/far/mitigations/${externalMitigation.id}`, {
      data: {
        mode_id: far.id,
        expected_version: current.version,
        mode_ids: [far.id],
        mitigation_type: 'Workaround',
        mitigation_steps: externalSteps,
        responsible_team: 'Reliability Engineering',
        status: 'Completed',
        cause_id: cause.id,
        external_bkm_url: externalUrl,
      },
    })
    expect(completedResponse.ok()).toBeTruthy()
    current = await getCurrentFarMode(request, far.id)
    expect(Number(current.version)).toBe(initialVersion + 5)

    const blockedDelete = await request.delete(`${farApiBase}/far/mitigations/${externalMitigation.id}`, {
      data: { mode_id: far.id, expected_version: current.version },
    })
    expect(blockedDelete.status()).toBe(409)
    const blockedPayload = await blockedDelete.json()
    expect(blockedPayload.detail.code).toBe('far_mitigation_completed_read_only')
    const afterBlockedDelete = await getCurrentFarMode(request, far.id)
    expect(Number(afterBlockedDelete.version)).toBe(Number(current.version))

    const processChangeResponse = await request.post(`${farApiBase}/far/mitigations`, {
      data: {
        mode_id: far.id,
        expected_version: current.version,
        mode_ids: [far.id],
        mitigation_type: 'Process Change',
        mitigation_steps: 'Require peer review before production changes',
        responsible_team: 'Platform',
        status: 'Not Started',
        cause_id: cause.id,
      },
    })
    expect(processChangeResponse.ok()).toBeTruthy()
    const processChange = await processChangeResponse.json()
    expect(processChange.mitigation_type).toBe('Process Change')
    expect(processChange.knowledge_bkm_id ?? null).toBeNull()
    expect(processChange.external_bkm_url ?? null).toBeNull()
    expect(processChange.monitoring_item_id ?? null).toBeNull()
    current = await getCurrentFarMode(request, far.id)
    expect(Number(current.version)).toBe(initialVersion + 6)

    const deletedProcessChange = await request.delete(`${farApiBase}/far/mitigations/${processChange.id}`, {
      data: { mode_id: far.id, expected_version: current.version },
    })
    expect(deletedProcessChange.ok()).toBeTruthy()
    current = await getCurrentFarMode(request, far.id)
    expect(Number(current.version)).toBe(initialVersion + 7)

    const history = await getFarHistory(request, far.id)
    expect(history[0].version).toBe(current.version)
    const latestMitigations = history[0].snapshot.mitigation_state
    expect(latestMitigations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: externalMitigation.id,
        external_bkm_url: externalUrl,
        responsible_team: 'Reliability Engineering',
        status: 'Completed',
      }),
      expect.objectContaining({
        knowledge_bkm_id: bkm.id,
        mitigation_steps: directSteps,
      }),
    ]))
    expect(latestMitigations.some((item: any) => Number(item.id) === Number(processChange.id))).toBe(false)
  })
  test('keeps linked Research artifacts visible and managed within FAR', async ({ page, sysApi: request }) => {
    await resetBrowserState(page)
    const { far } = await seedOperationalScenario(request)
    const investigation = await createInvestigation(request, {
      title: `PW-RES-${Date.now()}`,
      problem_statement: 'Investigation linked from FAR',
      category: 'Research',
      status: 'Analyzing',
      priority: 'High',
      systems: [far.system_name],
    })
    const currentMode = await getCurrentFarMode(request, far.id)
    await updateFarMode(request, far.id, {
      expected_version: currentMode.version,
      metadata_json: { linked_research_ids: [investigation.id] },
    })

    await page.goto(`/far?id=${far.id}`)
    const researchTab = page.getByRole('button', { name: /Research History/i })
    await expect(researchTab).toBeVisible()
    await researchTab.click()
    await expect(page.getByRole('heading', { name: investigation.title })).toBeVisible()

    const artifactCard = page.getByRole('heading', { name: investigation.title }).locator('xpath=ancestor::div[contains(@class,"group")][1]')
    await artifactCard.hover()
    await artifactCard.getByRole('button').nth(1).click()
    await expect(page.getByRole('heading', { name: investigation.title })).not.toBeVisible()
    await expect(page.getByText('No historical research artifacts currently mapped to this failure vector')).toBeVisible()

    await clickResilientButton(page, '+ Link Research Artifact')
    await page.getByPlaceholder('Search research artifacts...').fill(investigation.title)
    await clickResilientButton(page, new RegExp(investigation.title))
    await expect(page.getByRole('heading', { name: investigation.title })).toBeVisible()

    const relinkedCard = page.getByRole('heading', { name: investigation.title }).locator('xpath=ancestor::div[contains(@class,"group")][1]')
    await relinkedCard.hover()
    const openResearchButton = relinkedCard.getByRole('button').first()
    await expect(openResearchButton).toBeDisabled()
    await expect(openResearchButton).toHaveAttribute('data-module-action', 'research')
    await expect(openResearchButton).toHaveAttribute('data-module-action-reason', 'MODULE_RETIRED')
    await expect(page).toHaveURL(new RegExp(`/far\\?id=${far.id}$`))
  })
})


test.describe('FAR desktop heading readability', () => {
  for (const theme of ['Dark', 'Light'] as const) {
    test(`keeps RPN heading readable in ${theme} theme`, async ({ page, sysApi: request }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await resetBrowserState(page)
      await seedOperationalScenario(request)
      await page.goto('/far')
      await expect(page.locator('[data-workspace="far"]')).toBeVisible()
      await page.getByRole('button', { name: theme, exact: true }).click()
      await page.evaluate(() => (window as any).__DEBUG_OPERATIONAL_GRID_API__.ensureColumnVisible('rpn'))
      const text = page.locator('.ag-header-cell[col-id="rpn"] .ag-header-cell-text').first()
      await expect(text).toBeVisible()
      await expect.poll(() => text.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    })
  }
})
