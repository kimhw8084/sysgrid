import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import catalog from '../../../../contracts/system_management_v1.json'

const frontendRoot = path.resolve(__dirname, '../..')
const appSource = fs.readFileSync(path.join(frontendRoot, 'App.tsx'), 'utf8')
const navigationSource = fs.readFileSync(path.join(frontendRoot, 'components/shared/ShellNavigation.tsx'), 'utf8')
const policySource = fs.readFileSync(path.join(frontendRoot, 'policy/ModulePolicy.tsx'), 'utf8')

describe('System Management V1 module release policy contract', () => {
  it('classifies every catalog route and compatibility alias in the actual router', () => {
    for (const module of catalog.modules) {
      if (module.id !== 'home') expect(appSource).toContain(`moduleId="${module.id}"`)
      for (const route of [module.canonical_route, ...module.aliases]) {
        if (route === '/') expect(appSource).toContain('path="/"')
        else expect(appSource).toContain(`path="${route}`)
      }
    }
  })

  it('derives navigation metadata from the neutral catalog with local icon bindings only', () => {
    expect(navigationSource).toContain('MODULE_CATALOG.modules.reduce')
    expect(navigationSource).toContain('module.canonical_route')
    expect(navigationSource).toContain('module.aliases')
    expect(navigationSource).toContain('MODULE_ICONS')
    expect(navigationSource).not.toContain("permission: 'projects'")
  })

  it('keeps release-policy action ownership centralized across production V1 surfaces', () => {
    expect(policySource).toContain('ModulePolicyButton')
    expect(policySource).toContain('ModulePolicyLink')
    expect(policySource).toContain('POLICY_UNAVAILABLE')

    for (const relativePath of [
      'components/Dashboard.tsx',
      'components/assets/AssetDetailsView.tsx',
      'components/MonitoringGrid.tsx',
      'components/NetworkReal.tsx',
      'components/AuditLogs.tsx',
      'components/ConfigRegistry.tsx',
      'components/shared/GlobalSearch.tsx',
    ]) {
      const source = fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8')
      expect(source, relativePath).toMatch(/ModulePolicy(Button|Link)|useModuleActionPolicy/)
    }
  })
})
