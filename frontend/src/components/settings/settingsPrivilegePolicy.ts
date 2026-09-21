import type { EffectiveModulePolicyProjection } from '../../policy/ModulePolicy'

export type SettingsTab =
  | 'environments'
  | 'permissions'
  | 'groups'
  | 'system'
  | 'diagnostics'
  | 'tenants'
  | 'standards'
  | 'metadata'

export type SettingsPrivilegePolicy = {
  policyReady: boolean
  settingsManage: boolean
  globalConfigManage: boolean
  diagnosticsRead: boolean
  controlPlaneAdmin: boolean
}

type PolicyQueryState = {
  isLoading?: boolean
  isError?: boolean
}

export function resolveSettingsPrivilegePolicy(
  policy: EffectiveModulePolicyProjection | undefined,
  queryState: PolicyQueryState = {},
): SettingsPrivilegePolicy {
  const policyReady = Boolean(policy && !queryState.isLoading && !queryState.isError)
  const settingsManage = Boolean(policyReady && policy?.modules?.settings?.actions?.manage)
  const tenantAdmin = Boolean(policyReady && policy?.identity?.tenant_admin)

  return {
    policyReady,
    settingsManage,
    globalConfigManage: Boolean(settingsManage && tenantAdmin),
    diagnosticsRead: Boolean(policyReady && policy?.actions?.diagnostics?.read),
    controlPlaneAdmin: Boolean(policyReady && policy?.identity?.control_plane_admin),
  }
}

export function isSettingsTab(value: string | null): value is SettingsTab {
  return [
    'environments',
    'permissions',
    'groups',
    'system',
    'diagnostics',
    'tenants',
    'standards',
    'metadata',
  ].includes(value || '')
}

export function canViewSettingsTab(
  tab: SettingsTab,
  privileges: SettingsPrivilegePolicy,
): boolean {
  if (tab === 'environments' || tab === 'standards') return true
  if (tab === 'permissions' || tab === 'groups' || tab === 'metadata') {
    return privileges.settingsManage
  }
  if (tab === 'system') return privileges.globalConfigManage
  if (tab === 'diagnostics') return privileges.diagnosticsRead
  if (tab === 'tenants') return privileges.controlPlaneAdmin
  return false
}
