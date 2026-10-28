import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  testMatch: /(^|[\\/])(?:architecture-workflows|far-golden-controls|far-visible-grid|far-workflows|knowledge-workflows|research-workflows|external-services-bulk-preview|external-workflows|release-policy-root-preview|projects-navigation|projects-p04-project-story|projects-p05-work-plan|projects-p06-timeline|projects-p07-architecture|projects-p08-communication|projects-p09-outcomes|projects-p11-portfolio-regression|projects-saved-views|tenant-switch-safety|shell-dialogs|vendors-real-runtime|workspace-storage-preview)\.spec\.ts$/,
  grepInvert: process.env.SYSGRID_DESKTOP_ONLY === '1' ? /\b(?:320|390|740)(?:px|x\d+)?\b|\b(?:phone|mobile|narrow[- ]screen)\b/i : undefined,
  outputDir: 'test-results-root-preview',
})
