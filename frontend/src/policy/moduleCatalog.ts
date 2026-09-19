import catalog from '../../../contracts/system_management_v1.json'

export type ModuleStage = 'production' | 'preview' | 'disabled' | 'retired'

export type ModuleCatalogEntry = {
  id: string
  label: string
  canonical_route: string
  aliases: string[]
  navigation_group: string
  profile_membership: string
  default_stage: ModuleStage
  required_capability: string | null
  resource_owner: string
  root_preview_allowed: boolean
  atlas_identity: string
  embedded_support_projections: unknown[]
}

export const MODULE_CATALOG = catalog as {
  catalog_version: string
  profile_id: string
  stages: ModuleStage[]
  modules: ModuleCatalogEntry[]
}

export const MODULES_BY_ID = Object.fromEntries(
  MODULE_CATALOG.modules.map((module) => [module.id, module]),
) as Record<string, ModuleCatalogEntry>

export const getCatalogModule = (moduleId: string) => MODULES_BY_ID[moduleId]

const normalizePath = (path: string) => {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, '')
  return pathname || '/'
}

export const getCatalogModuleForPath = (path: string) => {
  const current = normalizePath(path)
  return MODULE_CATALOG.modules.find((module) => [module.canonical_route, ...module.aliases].some((candidate) => {
    const normalizedCandidate = normalizePath(candidate)
    return normalizedCandidate === '/'
      ? current === '/'
      : current === normalizedCandidate || current.startsWith(`${normalizedCandidate}/`)
  }))
}

export const getCatalogModuleIdForPath = (path: string) => getCatalogModuleForPath(path)?.id
