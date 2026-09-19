import { useQuery } from '@tanstack/react-query'
import { useId, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { apiFetch, getRequestScopeKey } from '../api/apiClient'
import { PermissionDeniedState } from '../components/shared/ShellStates'
import { getCatalogModule, getCatalogModuleForPath, type ModuleStage } from './moduleCatalog'

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

export type ModuleActionState = {
  moduleId: string
  label: string
  stage: ModuleStage | undefined
  available: boolean
  disabled: boolean
  blockedReason: string | null
  reason: string
  rootPreview: boolean
  policyPending: boolean
}

type ModulePolicyState = {
  data?: EffectiveModulePolicyProjection
  isLoading?: boolean
  isError?: boolean
}

export function resolveModuleActionState(moduleId: string, policyState: ModulePolicyState): ModuleActionState {
  const catalogModule = getCatalogModule(moduleId)
  const module = policyState.data?.modules?.[moduleId]
  const stage = module?.stage || catalogModule?.default_stage
  const label = module?.label || catalogModule?.label || moduleId
  const isPreviewTarget = stage === 'preview' || catalogModule?.default_stage === 'preview'
  const policyPending = Boolean(policyState.isLoading || policyState.isError || !policyState.data)
  const blockedReason = module?.blocked_reason ?? (
    isPreviewTarget && policyPending
      ? 'POLICY_UNAVAILABLE'
      : module
        ? (module.available ? null : 'MODULE_UNAVAILABLE')
        : null
  )
  // Production actions remain usable while the policy request settles. Preview
  // actions fail closed until effective backend policy explicitly enables them.
  const available = module?.available ?? (policyPending && !isPreviewTarget)

  let reason = `${label} is unavailable for the current account.`
  if (blockedReason === 'MODULE_DISABLED') {
    reason = `${label} is unavailable: module disabled.`
  } else if (blockedReason === 'MODULE_RETIRED') {
    reason = `${label} is unavailable: module retired.`
  } else if (blockedReason === 'SYSTEM_ROOT_REQUIRED' || isPreviewTarget) {
    reason = policyPending
      ? `${label} Preview unavailable: release policy is not available.`
      : `${label} Preview unavailable: System Root access is required.`
  } else if (blockedReason === 'MISSING_CAPABILITY') {
    reason = `${label} is unavailable: capability required.`
  } else if (blockedReason === 'POLICY_UNAVAILABLE') {
    reason = `${label} Preview unavailable: release policy is not available.`
  }

  return {
    moduleId,
    label,
    stage,
    available,
    disabled: !available,
    blockedReason,
    reason,
    rootPreview: Boolean(module?.root_preview),
    policyPending,
  }
}

export function useModuleActionPolicy(moduleId: string) {
  const policyQuery = useModulePolicy()
  return {
    ...resolveModuleActionState(moduleId, policyQuery),
    query: policyQuery,
  }
}

type PolicyButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  moduleId: string
  disabledReason?: string | null
}

export function ModulePolicyButton({ moduleId, disabledReason, disabled, title, children, ...props }: PolicyButtonProps) {
  const action = useModuleActionPolicy(moduleId)
  const isDisabled = Boolean(disabled || action.disabled)
  const accessibleReason = isDisabled ? (disabledReason || action.reason) : undefined
  const reasonId = useId()
  return (
    <button
      {...props}
      type={props.type || 'button'}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-label={props['aria-label']}
      aria-describedby={accessibleReason ? reasonId : undefined}
      title={title || accessibleReason}
      data-module-action={moduleId}
      data-module-action-state={isDisabled ? 'unavailable' : action.rootPreview ? 'root-preview' : 'available'}
      data-module-action-reason={action.blockedReason || undefined}
    >
      {children}
      {accessibleReason && <span id={reasonId} className="sr-only">{accessibleReason}</span>}
    </button>
  )
}

type PolicyLinkProps = Omit<LinkProps, 'to'> & {
  moduleId?: string
  to: string
  disabled?: boolean
  disabledReason?: string | null
  children: ReactNode
}

export function ModulePolicyLink({ moduleId, to, disabled, disabledReason, title, children, className, ...props }: PolicyLinkProps) {
  const resolvedModuleId = moduleId || getCatalogModuleForPath(to)?.id
  const action = useModuleActionPolicy(resolvedModuleId || 'unknown')
  const isDisabled = Boolean(disabled || !resolvedModuleId || action.disabled)
  const accessibleReason = isDisabled ? (disabledReason || action.reason) : undefined
  const reasonId = useId()
  const resolvedClassName = [className, isDisabled ? 'cursor-not-allowed opacity-60' : ''].filter(Boolean).join(' ')
  const linkProps = {
    ...props,
    onClick: isDisabled ? undefined : props.onClick,
    className: resolvedClassName,
    title: title || accessibleReason,
    'aria-disabled': isDisabled || undefined,
    'aria-describedby': accessibleReason ? reasonId : undefined,
    'data-module-action': resolvedModuleId,
    'data-module-action-state': isDisabled ? 'unavailable' : action.rootPreview ? 'root-preview' : 'available',
    'data-module-action-reason': action.blockedReason || undefined,
  }

  if (isDisabled) {
    return (
      <div
        {...(linkProps as unknown as HTMLAttributes<HTMLDivElement>)}
        role="link"
        aria-label={props['aria-label']}
      >
        {children}
        {accessibleReason && <span id={reasonId} className="sr-only">{accessibleReason}</span>}
      </div>
    )
  }

  return <Link {...linkProps} to={to}>{children}</Link>
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
