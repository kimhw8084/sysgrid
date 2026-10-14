import { expect } from '@playwright/test';
import { AuditLogsView } from './pom/AuditLogsView';
import { createAsset, createConnection, resetBrowserState, seedOperationalScenario, seedRackScenario } from './helpers/sysgrid';
import { test } from './helpers/sysgrid-test';
import { expectReadableGridText } from './helpers/grid-contrast';

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

  for (const theme of ['nordic-frost-v1', 'pure-clarity']) test(`ordinary asset writes expose scoped audit history in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
    expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy();
    await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme);
    const device = await createAsset(request, { name: `Audit write ${theme} ${Date.now()}`, system: 'Audit browser proof' });
    const saved = await request.put(`${apiBase}/devices/${device.id}`, {
      data: { owner: 'private-owner-proof', os_name: 'Linux', os_version: '2' },
    });
    expect(saved.ok()).toBeTruthy();
    const noop = await request.put(`${apiBase}/devices/${device.id}`, {
      data: { owner: 'private-owner-proof', os_name: 'Linux', os_version: '2' },
    });
    expect(noop.ok()).toBeTruthy();
    await page.goto(`/logs?target_table=devices&target_id=${device.id}`);
    await expect(page.getByText(`Scoped: devices // ${device.id}`)).toBeVisible();
    const rows = page.locator('.ag-center-cols-container .ag-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Updated asset');
    await expect(rows.nth(1)).toContainText('Created asset');
    await page.getByRole('button', { name: 'View change payload', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Audit Change Payload', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('pre')).toContainText('"changed_fields"');
    await expect(dialog.locator('pre')).toContainText('"owner"');
    await expect(dialog.locator('pre')).toContainText('"os_service_changed": true');
    await expect(dialog).not.toContainText('private-owner-proof');
    await page.screenshot({ path: testInfo.outputPath('asset-audit-payload.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Close audit payload', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Open target record', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/asset\\?id=${device.id}(?:&|$)`));
    await expect(page.getByText(device.name, { exact: true }).first()).toBeVisible();
  });

  for (const theme of ['nordic-frost-v1', 'pure-clarity']) for (const viewport of [{ width: 390, height: 844 }, { width: 740, height: 360 }]) {
    test(`audit payload remains readable and keyboard accessible at ${viewport.width}x${viewport.height} in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy();
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme);
      const device = await createAsset(request, {
        name: `Payload viewport ${theme} ${Date.now()}`, system: 'Payload proof', type: 'Physical', model: 'R650',
        owner: 'Operations', asset_tag: 'payload-proof', serial_number: 'proof-serial', manufacturer: 'Vendor',
        os_name: 'Linux', os_version: '1', environment: 'Test',
      });
      await page.goto(`/logs?target_table=devices&target_id=${device.id}`);
      const trigger = page.getByRole('button', { name: 'View change payload', exact: true }).first();
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Audit Change Payload', exact: true });
      const panel = dialog.locator(':scope > div').first();
      await expect(dialog).toBeVisible();
      await expect.poll(() => panel.evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1);
      const geometry = await panel.evaluate(element => {
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: innerWidth, height: innerHeight };
      });
      await testInfo.attach('audit-payload-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
      expect.soft(geometry.top).toBeGreaterThanOrEqual(15);
      expect.soft(geometry.bottom).toBeLessThanOrEqual(viewport.height - 15);
      expect.soft(geometry.left).toBeGreaterThanOrEqual(15);
      expect.soft(geometry.right).toBeLessThanOrEqual(viewport.width - 15);
      const close = dialog.getByRole('button', { name: 'Close audit payload', exact: true });
      const closeBox = await close.boundingBox();
      expect.soft(closeBox?.width).toBeGreaterThanOrEqual(40);
      expect.soft(closeBox?.height).toBeGreaterThanOrEqual(40);
      await expectReadableGridText(page, testInfo, 'audit-payload', '[role="dialog"][aria-label="Audit Change Payload"] :is(h3, p, pre)');
      await close.focus();
      await page.keyboard.press('Tab');
      await expect(dialog.locator('pre')).toBeFocused();
      await page.keyboard.press('End');
      await expect.poll(() => dialog.locator('pre').evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);
      await expect(close).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath(`audit-payload-${viewport.width}-${theme}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }

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

  test('round-trips a Rack summary through scoped Audit Logs', async ({ page, sysApi: request }) => {
    const { rackA1 } = await seedRackScenario(request);

    await page.goto(`/racks?id=${rackA1.id}`);
    await expect(page.getByText(`${rackA1.name} Summary`, { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Open Audit Logs', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/logs\\?target_table=racks&target_id=${rackA1.id}$`));
    await expect(page.getByText(`Scoped: racks // ${rackA1.id}`)).toBeVisible();

    const rackTargetButton = page.getByRole('button', { name: 'Open target record' }).first();
    await expect(rackTargetButton).toBeEnabled();
    await rackTargetButton.click();
    await expect(page).toHaveURL(new RegExp(`/racks\\?id=${rackA1.id}$`));
    await expect(page.getByText(`${rackA1.name} Summary`, { exact: true })).toBeVisible();
  });
});
