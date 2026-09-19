import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  expect: {
    timeout: 15_000
  },
  reporter: [['list'], ['html', { open: 'never' }], ['./llm-reporter.ts']],
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    extraHTTPHeaders: {
      'X-User-Id': process.env.USER_ID || process.env.SYSGRID_VERIFY_USER_ID || 'haewon.kim',
      'X-Tenant-Id': process.env.PW_TENANT_ID || '1'
    }
  }
})
