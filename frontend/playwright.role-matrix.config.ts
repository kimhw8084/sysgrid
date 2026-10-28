import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  testMatch: /(^|[\\/])role-matrix\.spec\.ts$/,
  reporter: [['list']],
})
