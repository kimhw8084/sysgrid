import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

// Preserve the existing normal-user and root-preview gates. This additional
// gate retains the reviewed desktop screenshots and interaction regressions.
export default defineConfig({
  ...baseConfig,
  testMatch: [
    /(^|[\\/])overlay-audit\.spec\.ts$/,
    /(^|[\\/])(visual-foundation|rack-reference|audit-reference|settings-reference|settings-history-reference|history-reference|theme-preference)\.spec\.ts$/,
  ],
  // Existing phone cases remain available in the base configuration. The
  // owner's current qualification scope is desktop window resizing only.
  grepInvert: /\b(?:320|390)\b/,
  outputDir: 'test-results-desktop',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-desktop' }], ['./llm-reporter.ts']],
})
