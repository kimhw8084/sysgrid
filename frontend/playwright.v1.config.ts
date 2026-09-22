import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  testMatch: [
    /(^|[\\/])(assets-(golden-evidence|revert|stage33-evidence|stage34-evidence|stage35-evidence|stage36-evidence|vendors-bulk-preview|workflows)|audit-logs-workflows|blank-slate-audit|crud-api-contracts|dashboard-workflows|home-truth|monitoring-(comprehensive|workflows)|network-workflows|pre-test-check|racks-workflows|sentinel_(comprehensive|smoke)|service-workflows|settings-(and-audit|standards)|shell-and-search|smoke|view-(deeplink-matrix|empty-states)|workspace-collaborative-views|eight-route-smoke|release-policy-normal)\.spec\.ts$/,
  ],
  outputDir: 'test-results-v1',
})
