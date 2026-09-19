import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  // The normal-v1 release contract is executed by playwright.v1.config.ts.
  // The historical diagnostic run uses the explicit root-preview profile;
  // retain root policy coverage in its dedicated config instead of running a
  // normal-only assertion under root capabilities.
  testIgnore: /(^|[\\/])release-policy-normal\.spec\.ts$/,
  outputDir: 'test-results-all',
})
