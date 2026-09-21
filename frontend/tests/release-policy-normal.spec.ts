import { expect, test } from '@playwright/test'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const headers = {
  'X-User-Id': process.env.USER_ID || 'haewon.kim',
  'X-Tenant-Id': process.env.PW_TENANT_ID || '1',
}

test.describe('CHG-120 normal-v1 release policy', () => {
  test('exposes production modules and fails closed for preview modules', async ({ page, request }) => {
    const response = await request.get(`${apiBase}/policy/module-availability`, { headers })
    expect(response.ok()).toBeTruthy()
    const policy = await response.json()

    expect(policy.identity.system_root).toBe(false)
    for (const moduleId of ['home', 'assets', 'monitoring', 'services', 'network', 'racks', 'logs', 'settings']) {
      expect(policy.modules[moduleId], moduleId).toMatchObject({ available: true, stage: 'production' })
    }
    for (const moduleId of ['projects', 'far', 'knowledge', 'vendors', 'external', 'research', 'architecture']) {
      expect(policy.modules[moduleId], moduleId).toMatchObject({ available: false })
      expect(policy.modules[moduleId].blocked_reason).toBe('SYSTEM_ROOT_REQUIRED')
    }

    await page.goto('/')
    await expect(page.getByText('Observed health history (24h)')).toBeVisible()
    for (const moduleId of ['projects', 'far', 'knowledge', 'vendors', 'external', 'research', 'architecture']) {
      await expect(page.locator(`[data-sg-content-panel="true"] [data-module-action="${moduleId}"]`), moduleId).toHaveCount(0)
    }

    await page.goto('/far')
    await expect(page.locator('[data-sg-state="permission-denied"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Access unavailable' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'FAR', exact: true })).not.toBeVisible()

    const knowledgeResponse = await request.get(`${apiBase}/knowledge`, { headers })
    expect(knowledgeResponse.status()).toBe(403)
  })
})
