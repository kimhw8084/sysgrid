import { expect } from '@playwright/test';
import { AuditLogsView } from './pom/AuditLogsView';
import { createConnection, resetBrowserState, seedOperationalScenario, seedRackScenario } from './helpers/sysgrid';
import { test } from './helpers/sysgrid-test';

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1';

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

  test('opens exact device and port connection targets while leaving unsupported targets disabled', async ({ page, sysApi: request }) => {
    await resetBrowserState(page);
    const { primary, secondary, maintenance } = await seedOperationalScenario(request);
    const { devicePrimary } = await seedRackScenario(request);
    const connection = await createConnection(request, {
      device_a_id: primary.id,
      source_port: 'eth20',
      device_b_id: secondary.id,
      target_port: 'eth21',
      link_type: 'Data',
      speed_gbps: 10,
      unit: 'Gbps',
      status: 'Active',
    });
    const updateResponse = await request.put(`${apiBase}/networks/connections/${connection.id}`, {
      data: {
        source_device_id: primary.id,
        source_port: 'eth20',
        target_device_id: secondary.id,
        target_port: 'eth21',
        link_type: 'Data',
      },
    });
    expect(updateResponse.ok()).toBeTruthy();

    await page.goto(`/logs?target_table=devices&target_id=${devicePrimary.id}`);
    await expect(page.getByText(`Scoped: devices // ${devicePrimary.id}`)).toBeVisible();
    const deviceTargetButton = page.getByRole('button', { name: 'Open target record' }).first();
    await expect(deviceTargetButton).toBeEnabled();
    await deviceTargetButton.click();
    await expect(page).toHaveURL(new RegExp(`/asset\\?id=${devicePrimary.id}(?:&|$)`));

    await page.goto(`/logs?target_table=port_connections&target_id=${connection.id}`);
    await expect(page.getByText(`Scoped: port_connections // ${connection.id}`)).toBeVisible();
    const networkTargetButton = page.getByRole('button', { name: 'Open target record' }).first();
    await expect(networkTargetButton).toBeEnabled();
    await networkTargetButton.click();
    await expect(page).toHaveURL(new RegExp(`/network\\?id=${connection.id}(?:&|$)`));

    await page.goto(`/logs?target_table=maintenance_windows&target_id=${maintenance.id}`);
    await expect(page.getByText(`Scoped: maintenance_windows // ${maintenance.id}`)).toBeVisible();
    const unsupportedTargetButton = page.getByRole('button', { name: 'Open target record' }).first();
    await expect(unsupportedTargetButton).toBeDisabled();
    await expect(unsupportedTargetButton).toHaveAttribute('title', 'No target route recorded.');
  });
});
