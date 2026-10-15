import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Supplemental rendered interaction qualification; the complete Chromium V1 gate remains required.
export default defineConfig({
  ...base,
  testMatch: /(^|[\\/])(notification-(layout|keyboard)|configuration-sync|browser-reset-isolation|phone-grid-identity|eight-route-smoke|asset-form-safety|grid-contrast)\.spec\.ts$/,
  outputDir: 'test-results-ui-engines',
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({
    name: browserName,
    use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit' },
  })),
})
