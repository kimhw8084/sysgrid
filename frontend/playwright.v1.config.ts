import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  testMatch: [
    /(^|[\\/])settings-permission-history\.spec\.ts$/,
    /(^|[\\/])settings-sync-workflow\.spec\.ts$/,
    /(^|[\\/])settings-bulk-menu\.spec\.ts$/,
    /(^|[\\/])settings-permission-pending\.spec\.ts$/,
    /(^|[\\/])settings-permission-clarity\.spec\.ts$/,
    /(^|[\\/])workspace-modal-motion\.spec\.ts$/,
    /(^|[\\/])network-import-workflows\.spec\.ts$/,
    /(^|[\\/])overlay-surface-readability\.spec\.ts$/,
    /(^|[\\/])network-preference-race\.spec\.ts$/,
    /(^|[\\/])asset-import-workflows\.spec\.ts$/,
    /(^|[\\/])asset-form-safety\.spec\.ts$/,
    /(^|[\\/])asset-inline-save\.spec\.ts$/,
    /(^|[\\/])grid-contrast\.spec\.ts$/,
    /(^|[\\/])maintenance-workspace\.spec\.ts$/,
    /(^|[\\/])maintenance-windows\.spec\.ts$/,
    /(^|[\\/])asset-credentials\.spec\.ts$/,
    /(^|[\\/])(assets-(golden-evidence|revert|stage33-evidence|stage34-evidence|stage35-evidence|stage36-evidence|vendors-bulk-preview|workflows)|audit-logs-workflows|blank-slate-audit|crud-api-contracts|dashboard-workflows|home-truth|monitoring-(comprehensive|workflows)|network-workflows|operational-resilience|pre-test-check|racks-workflows|sentinel_(comprehensive|smoke)|service-workflows|settings-(and-audit|standards)|shell-and-search|smoke|view-(deeplink-matrix|empty-states)|workspace-collaborative-views|eight-route-smoke|release-policy-normal)\.spec\.ts$/,
  ],
  outputDir: 'test-results-v1',
})
