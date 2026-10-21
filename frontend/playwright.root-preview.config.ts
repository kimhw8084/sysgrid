import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  testMatch: /(^|[\\/])(release-policy-root-preview|tenant-switch-safety|shell-dialogs|workspace-storage-preview)\.spec\.ts$/,
  outputDir: 'test-results-root-preview',
})
