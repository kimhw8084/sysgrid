import { expect, test } from '@playwright/test'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const headers = {
  'X-User-Id': process.env.USER_ID || 'haewon.kim',
  'X-Tenant-Id': process.env.PW_TENANT_ID || '1',
}

test.describe('CHG-120 root-preview release policy', () => {
  test('opens only explicitly allowed preview modules through effective policy', async ({ page, request }) => {
    const response = await request.get(`${apiBase}/policy/module-availability`, { headers })
    expect(response.ok()).toBeTruthy()
    const policy = await response.json()

    expect(policy.identity.system_root).toBe(true)
    for (const moduleId of ['home', 'assets', 'monitoring', 'services', 'network', 'racks', 'logs', 'settings', 'projects', 'far', 'knowledge', 'vendors', 'external', 'research', 'architecture']) {
      expect(policy.modules[moduleId], moduleId).toMatchObject({ available: true })
    }
    for (const moduleId of ['projects', 'far', 'knowledge', 'vendors', 'external', 'research', 'architecture']) {
      expect(policy.modules[moduleId].root_preview).toBe(true)
    }

    await page.goto('/')
    await expect(page.getByText('Observed health history (24h)')).toBeVisible()
    expect(await page.locator('[data-sg-content-panel="true"] [data-module-action="far"]').count()).toBe(0)

    const farTitle = `ROOT-PREVIEW-FAR-${Date.now()}`
    const farResponse = await request.post(`${apiBase}/far/modes`, {
      headers,
      data: {
        system_name: 'ROOT-PREVIEW-SYSTEM',
        title: farTitle,
        effect: 'Preview search proof',
        severity: 8,
        occurrence: 4,
        detection: 3,
      },
    })
    expect(farResponse.ok()).toBeTruthy()
    const far = await farResponse.json()

    const searchTrigger = page.locator('button').filter({ hasText: /Search released and authorized records/i }).first()
    await searchTrigger.click()
    const searchInput = page.getByPlaceholder(/Search released and authorized records/i)
    await searchInput.fill(farTitle)
    const previewResult = page.getByRole('link', { name: new RegExp(farTitle) }).first()
    await expect(previewResult).toBeVisible()
    await expect(page.getByText('Preview / unreleased')).toBeVisible()
    await previewResult.click()
    await expect(page).toHaveURL(new RegExp(`/far\\?id=${far.id}`))
  })
})
