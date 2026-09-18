import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { apiFetch, getRequestScopeKey } from '../api/apiClient'
import { PermissionDeniedState } from '../components/shared/ShellStates'
import { getCatalogModule, type ModuleStage } from './moduleCatalog'

export type EffectiveModulePolicy = {
  module_id: string
  label: string
  stage: ModuleStage
  default_stage: ModuleStage
  available: boolean
  blocked_reason: string | null
  root_preview: boolean
  actions?: {
    read?: boolean
    write?: boolean
    import?: boolean
    export?: boolean
    preview?: boolean
  }
}

export type EffectiveModulePolicyProjection = {
  catalog_version: string
  profile_id: string
  identity: {
    authenticated: boolean
    tenant_id: number | string | null
    access_role: string | null
    operator_role: string | null
    tenant_admin: boolean
    system_root: boolean
  }
  actions: { diagnostics?: { read?: boolean } }
  modules: Record<string, EffectiveModulePolicy>
}

export function useModulePolicy() {
  return useQuery<EffectiveModulePolicyProjection>({
    queryKey: ['module-policy', getRequestScopeKey()],
    queryFn: async () => (await apiFetch('/api/v1/policy/module-availability')).json(),
    staleTime: 30000,
    retry: 1,
  })
}

export function moduleIsReleased(policy: EffectiveModulePolicyProjection | undefined, moduleId: string) {
  const module = policy?.modules?.[moduleId]
  return Boolean(module?.available)
}

export function ModulePolicyGate({ moduleId, children }: { moduleId: string; children: ReactNode }) {
  const policyQuery = useModulePolicy()
  const catalogModule = getCatalogModule(moduleId)
  const module = policyQuery.data?.modules?.[moduleId]
  const label = module?.label || catalogModule?.label || moduleId

  // Released routes remain recoverable while the policy request is in flight or
  // temporarily unavailable. Preview routes fail closed and never mount first.
  if ((policyQuery.isLoading || policyQuery.isError) && catalogModule?.default_stage === 'preview') {
    return <PermissionDeniedState area={label} />
  }
  if (!module && (policyQuery.isLoading || policyQuery.isError)) {
    if (catalogModule?.default_stage === 'production') return <>{children}</>
    return <PermissionDeniedState area={label} />
  }

  if (!module?.available) return <PermissionDeniedState area={label} />
  return <>{children}</>
}
