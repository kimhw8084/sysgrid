import { expect, test } from '@playwright/test'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const headers = {
  'X-User-Id': process.env.USER_ID || 'haewon.kim',
  'X-Tenant-Id': process.env.PW_TENANT_ID || '1',
}

test.describe('CHG-120 System Root release policy', () => {
  test('keeps all released modules available without preview labeling', async ({ page, request }) => {
    const response = await request.get(`${apiBase}/policy/module-availability`, { headers })
    expect(response.ok()).toBeTruthy()
    const policy = await response.json()

    expect(policy.identity.system_root).toBe(true)
    const moduleIds = ['home', 'projects', 'assets', 'monitoring', 'services', 'network', 'racks', 'logs', 'settings', 'far', 'knowledge', 'vendors', 'external', 'research', 'architecture']
    for (const moduleId of moduleIds) {
      expect(policy.modules[moduleId], moduleId).toMatchObject({ available: true, stage: 'production', root_preview: false })
    }

    await page.goto('/')
    await expect(page.getByText('Observed health history (24h)')).toBeVisible()
    expect(await page.locator('[data-sg-content-panel="true"] [data-module-action="far"]').count()).toBe(0)

    const farTitle = `RELEASED-FAR-${Date.now()}`
    const farResponse = await request.post(`${apiBase}/far/modes`, {
      headers,
      data: {
        system_name: 'RELEASED-SYSTEM',
        title: farTitle,
        effect: 'Released search proof',
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
    const releasedResult = page.getByRole('link', { name: new RegExp(farTitle) }).first()
    await expect(releasedResult).toBeVisible()
    await expect(page.getByText('Preview / unreleased')).toHaveCount(0)
    await releasedResult.click()
    await expect(page).toHaveURL(new RegExp(`/far\\?id=${far.id}`))
  })
})
