import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  reporter: [['list'], ['html', { open: 'never' }]],
  testMatch: [
    /(^|[\\/])(?:assets-golden-evidence|assets-revert|assets-stage33-evidence|assets-stage34-evidence|assets-stage35-evidence|assets-stage36-evidence|assets-vendors-bulk-preview|assets-view-surfaces|assets-workflows|audit-logs-workflows|blank-slate-audit|crud-api-contracts|dashboard-workflows|eight-route-smoke|monitoring-comprehensive|monitoring-workflows|network-workflows|notification-keyboard|notification-layout|pre-test-check|racks-workflows|release-policy-normal|sentinel_comprehensive|sentinel_smoke|service-workflows|settings-and-audit|settings-standards|shell-and-search|smoke|view-deeplink-matrix|view-empty-states|workspace-collaborative-views)\.spec\.ts$/,
    /(^|[\\/])(?:architecture-workflows|external-workflows|far-workflows|golden-eight-seeded-visual-matrix|knowledge-workflows|projects-creation-flow|projects-navigation|projects-out40-slice-e-timeline-dependency-a11y|projects-out40-slice-f-task-drawer-a11y|projects-out40-slice-h-gantt-modernization|projects-p04-project-story|projects-p06-timeline|research-workflows|vendors-real-runtime)\.spec\.ts$/,
  ],
  grepInvert: process.env.SYSGRID_DESKTOP_ONLY === '1' ? /\b(?:320|390|740)(?:px|x\d+)?\b|\b(?:phone|mobile|narrow[- ]screen)\b/i : undefined,
  outputDir: 'test-results-v1',
})
