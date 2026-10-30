import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  testMatch: /(^|[\\/])(?:far-golden-controls|far-visible-grid|far-workflows|external-services-bulk-preview|external-workflows|release-policy-root-preview|tenant-switch-safety|shell-dialogs|vendors-real-runtime|workspace-storage-preview)\.spec\.ts$/,
  grepInvert: process.env.SYSGRID_DESKTOP_ONLY === '1' ? /\b(?:320|390|740)(?:px|x\d+)?\b|\b(?:phone|mobile|narrow[- ]screen)\b/i : undefined,
  outputDir: 'test-results-root-preview',
})
