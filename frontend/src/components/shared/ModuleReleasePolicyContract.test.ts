import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import catalog from '../../../../contracts/system_management_v1.json'
import { MODULE_CATALOG, SYSGRID_SEPARATE_APP_MODULE_IDS } from '../../policy/moduleCatalog'
import { SHELL_NAV_GROUPS } from './ShellNavigation'

const frontendRoot = path.resolve(__dirname, '../..')
const appSource = fs.readFileSync(path.join(frontendRoot, 'App.tsx'), 'utf8')
const navigationSource = fs.readFileSync(path.join(frontendRoot, 'components/shared/ShellNavigation.tsx'), 'utf8')
const policySource = fs.readFileSync(path.join(frontendRoot, 'policy/ModulePolicy.tsx'), 'utf8')

describe('System Management V1 module release policy contract', () => {
  it('classifies active routes and explicitly retires separate-app routes', () => {
    const separateAppModules = new Set(catalog.modules.filter(module => module.application_owner === 'separate_application').map(module => module.id))
    const activeModules = catalog.modules.filter(module => module.sysgrid_route_class === 'active')
    const retiredNoticeModules = catalog.modules.filter(module => module.sysgrid_route_class === 'retired_notice')
    expect(SYSGRID_SEPARATE_APP_MODULE_IDS).toEqual(separateAppModules)
    expect([...separateAppModules]).toEqual(['projects', 'architecture', 'research', 'knowledge'])
    expect(retiredNoticeModules.map(module => module.id)).toEqual([...separateAppModules])
    expect(activeModules.every(module => module.application_owner === 'sysgrid')).toBe(true)
    expect(retiredNoticeModules.every(module => module.application_owner === 'separate_application')).toBe(true)
    expect(new Set(SHELL_NAV_GROUPS.flatMap(group => group.items.map(item => item.moduleId))))
      .toEqual(new Set(activeModules.map(module => module.id)))
    expect(MODULE_CATALOG.modules.map(module => module.id)).toEqual(catalog.modules.map(module => module.id))
    for (const module of catalog.modules) {
      if (module.sysgrid_route_class === 'active' && module.id !== 'home') expect(appSource).toContain(`moduleId="${module.id}"`)
      if (module.sysgrid_route_class === 'retired_notice') expect(appSource).toContain(`RetiredWorkspaceNotice moduleName="${module.label}"`)
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
    expect(navigationSource).toContain("module.sysgrid_route_class !== 'active'")
    expect(navigationSource).not.toContain('RETIRED_SYSGRID_MODULE_IDS')
    expect(navigationSource).not.toContain("permission: 'projects'")
  })

  it('keeps retired route notices in a separate qualification inventory', () => {
    const suite = JSON.parse(fs.readFileSync(path.join(frontendRoot, '../tests/qualification-suite.json'), 'utf8'))
    expect(suite.retired_route_notices).toEqual(['retired-route-notices.spec.ts'])
    expect(suite.release_blocking).not.toContain('retired-route-notices.spec.ts')
    expect(suite.separate_app_ownership).not.toContain('retired-route-notices.spec.ts')
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
