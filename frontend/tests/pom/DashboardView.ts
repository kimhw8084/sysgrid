import { Page, expect } from '@playwright/test';
import { BaseView } from './BaseView';

export class DashboardView extends BaseView {
  constructor(page: Page) {
    super(page);
  }

  async navigateToTab(tabName: string) {
    const cardTitle = tabName === 'Assets' ? 'Infrastructure assets' : 'Monitoring definitions'
    await this.page.getByText(cardTitle, { exact: true }).click()
    await this.waitForAppIdle()
  }

  async verifyUrlTab(tabName: string, expectedPath: string) {
      await expect(this.page).toHaveURL(new RegExp(`${expectedPath}`));
  }
}
