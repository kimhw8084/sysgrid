import { test, expect } from '@playwright/test';
import { DashboardView } from './pom/DashboardView';
import { resetBrowserState, waitForAppIdle } from './helpers/sysgrid';

test.describe('Dashboard Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await resetBrowserState(page);
  });

  test('navigates to tabs and syncs URL parameter', async ({ page }) => {
    const dashboard = new DashboardView(page);
    await page.goto('/');
    await dashboard.waitForAppIdle();

    // Verify navigating to a tab updates the URL
    await dashboard.navigateToTab('Assets');
    await dashboard.verifyUrlTab('assets', '/asset');
    
    // Verify navigating to another tab
    await page.goto('/');
    await dashboard.waitForAppIdle();
    await dashboard.navigateToTab('Monitoring');
    await dashboard.verifyUrlTab('monitoring', '/monitoring');
  });
});
