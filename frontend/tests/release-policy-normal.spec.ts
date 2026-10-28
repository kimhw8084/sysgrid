import { expect, test } from '@playwright/test'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const headers = {
  'X-User-Id': process.env.USER_ID || 'haewon.kim',
  'X-Tenant-Id': process.env.PW_TENANT_ID || '1',
}

test.describe('CHG-120 expanded normal-v1 release policy', () => {
  test('exposes all fifteen modules to a capable non-root tenant operator', async ({ page, request }) => {
    const response = await request.get(`${apiBase}/policy/module-availability`, { headers })
    expect(response.ok()).toBeTruthy()
    const policy = await response.json()

    expect(policy.identity.system_root).toBe(false)
    expect(policy.identity.tenant_admin).toBe(true)
    const moduleIds = ['home', 'projects', 'assets', 'monitoring', 'services', 'network', 'racks', 'logs', 'settings', 'far', 'knowledge', 'vendors', 'external', 'research', 'architecture']
    for (const moduleId of moduleIds) {
      expect(policy.modules[moduleId], moduleId).toMatchObject({
        available: true,
        stage: 'production',
        default_stage: 'production',
        root_preview: false,
      })
    }

    await page.goto('/')
    await expect(page.getByText('Observed health history (24h)')).toBeVisible()
    await page.goto('/far')
    await expect(page.locator('[data-sg-state="permission-denied"]')).toHaveCount(0)

    const knowledgeResponse = await request.get(`${apiBase}/knowledge`, { headers })
    expect(knowledgeResponse.status()).toBe(200)
  })
})
