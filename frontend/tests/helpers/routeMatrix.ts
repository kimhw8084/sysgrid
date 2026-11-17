import { MODULE_CATALOG } from '../../src/policy/moduleCatalog'

const asRoute = (module: (typeof MODULE_CATALOG.modules)[number]) => ({
  moduleId: module.id,
  path: module.canonical_route,
  name: module.label,
  aliases: module.aliases,
})

export const activeSysGridRouteMatrix = MODULE_CATALOG.modules
  .filter((module) => module.sysgrid_route_class === 'active')
  .map(asRoute)

export const retiredSysGridRouteMatrix = MODULE_CATALOG.modules
  .filter((module) => module.sysgrid_route_class === 'retired_notice')
  .map(asRoute)

export const appRouteMatrix = MODULE_CATALOG.modules.map(asRoute)

export const protectedAppRoutes = activeSysGridRouteMatrix
  .filter((route) => route.path !== '/')
  .map((route) => route.path)
