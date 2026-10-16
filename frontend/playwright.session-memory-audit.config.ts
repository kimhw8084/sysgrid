import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig({
  ...base,
  testMatch: /session-memory-audit\.spec\.ts$/,
  outputDir: '../session-memory-results',
  reporter: [['list'], ['json', { outputFile: '../session-memory.json' }]],
})
