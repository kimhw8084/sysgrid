import { describe, expect, it } from 'vitest'
import {
  canViewSettingsTab,
  resolveSettingsPrivilegePolicy,
  type SettingsPrivilegePolicy,
} from './settingsPrivilegePolicy'

const policy = (overrides: Record<string, unknown> = {}) => ({
  identity: {
    tenant_admin: false,
    system_root: false,
    control_plane_admin: false,
    ...overrides,
  },
  actions: { diagnostics: { read: false } },
  modules: { settings: { actions: { manage: false } } },
}) as any

describe('Settings privilege policy', () => {
  it('fails closed until effective policy is affirmative and available', () => {
    expect(resolveSettingsPrivilegePolicy(undefined, { isLoading: true })).toEqual({
      policyReady: false,
      settingsManage: false,
      globalConfigManage: false,
      diagnosticsRead: false,
      controlPlaneAdmin: false,
    })
    expect(resolveSettingsPrivilegePolicy(policy({ tenant_admin: true }), { isError: true }).settingsManage).toBe(false)
  })

  it('derives Settings management, global configuration, diagnostics, and tenants independently', () => {
    const privileges = resolveSettingsPrivilegePolicy({
      ...policy({ tenant_admin: true, control_plane_admin: true }),
      actions: { diagnostics: { read: true } },
      modules: { settings: { actions: { manage: true } } },
    } as any)

    expect(privileges).toMatchObject({
      policyReady: true,
      settingsManage: true,
      globalConfigManage: true,
      diagnosticsRead: true,
      controlPlaneAdmin: true,
    })
  })

  it('does not derive diagnostics or tenants from tenant admin or System Root', () => {
    const privileges = resolveSettingsPrivilegePolicy(policy({ tenant_admin: true, system_root: true }))
    expect(privileges.diagnosticsRead).toBe(false)
    expect(privileges.controlPlaneAdmin).toBe(false)
  })

  it('keeps personal Parameters and Standards available while management tabs are restricted', () => {
    const privileges: SettingsPrivilegePolicy = {
      policyReady: true,
      settingsManage: false,
      globalConfigManage: false,
      diagnosticsRead: false,
      controlPlaneAdmin: false,
    }
    expect(canViewSettingsTab('environments', privileges)).toBe(true)
    expect(canViewSettingsTab('standards', privileges)).toBe(true)
    expect(canViewSettingsTab('permissions', privileges)).toBe(false)
    expect(canViewSettingsTab('groups', privileges)).toBe(false)
    expect(canViewSettingsTab('metadata', privileges)).toBe(false)
    expect(canViewSettingsTab('system', privileges)).toBe(false)
    expect(canViewSettingsTab('diagnostics', privileges)).toBe(false)
    expect(canViewSettingsTab('tenants', privileges)).toBe(false)
  })

  it('requires global configuration authority for Analysis', () => {
    const privileges: SettingsPrivilegePolicy = {
      policyReady: true,
      settingsManage: true,
      globalConfigManage: false,
      diagnosticsRead: false,
      controlPlaneAdmin: false,
    }
    expect(canViewSettingsTab('system', privileges)).toBe(false)
  })
})
