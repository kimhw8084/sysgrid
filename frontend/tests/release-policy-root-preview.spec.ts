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
    await expect(page.getByText('Stability Pulse')).toBeVisible()
    await expect(page.locator('[data-module-action="far"][aria-disabled="true"]')).toHaveCount(0)
    expect(await page.locator('[data-module-action="far"][data-module-action-state="root-preview"]').count()).toBeGreaterThan(0)

    await page.goto('/far')
    await expect(page.locator('[data-sg-state="permission-denied"]')).not.toBeVisible()
    await expect(page.getByRole('heading', { name: 'Failure Matrix', exact: true })).toBeVisible()
  })
})
