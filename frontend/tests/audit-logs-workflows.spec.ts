import { test, expect } from '@playwright/test';
import { AuditLogsView } from './pom/AuditLogsView';
import { resetBrowserState } from './helpers/sysgrid';

test.describe('Audit Logs Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await resetBrowserState(page);
  });

  test('AuditLogs view loads and is compliant', async ({ page }) => {
    const auditLogs = new AuditLogsView(page);
    await page.goto('/audit');
    await auditLogs.waitForAppIdle();

    // Check Golden Template Primitives
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('target scope changes refetch the new target and export names loaded-page semantics', async ({ page }) => {
    const auditRequests: URL[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/audit')) auditRequests.push(new URL(request.url()));
    });

    await page.goto('/logs?target_table=devices&target_id=A');
    await expect(page.getByText('Scoped: devices // A')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export loaded CSV' })).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export loaded CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^SysGrid_AuditLoadedResult_\d{4}-\d{2}-\d{2}\.csv$/);

    await page.goto('/logs?target_table=devices&target_id=B');
    await expect(page.getByText('Scoped: devices // B')).toBeVisible();

    expect(auditRequests.some((url) => url.searchParams.get('target_id') === 'A')).toBe(true);
    expect(auditRequests.some((url) => url.searchParams.get('target_id') === 'B')).toBe(true);
  });
});
