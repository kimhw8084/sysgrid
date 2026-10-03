import { describe, expect, it } from 'vitest'
import { formatRecordedPermissions, hasCompleteHistoryPermissions, historyPermissionViews, normalizeHistoryPermissionLevel, recordedPermissionLevel, recordedPermissionState } from './historyPermissions'

const standard = { is_admin: false, role_id: null, role_permissions: {}, custom_permissions: {} }

describe('recorded tenant permission semantics', () => {
  it.each([
    [{ all: 1, assets: 0 }, { level: 1, global: 1 }],
    [{ all: 0, assets: 0 }, { level: 0, global: 0 }],
    [{ assets: 0 }, { level: 3, global: 3 }],
    [{ all: 1, assets: 3 }, { level: 3, global: 1 }],
  ])('exposes the global minimum after custom overrides: %s', (custom_permissions, expected) => {
    expect(recordedPermissionState({ ...standard, role_id: 7, role_permissions: { all: 3 }, custom_permissions }, 'assets')).toEqual(expected)
  })
  it.each([
    [true, 1], [false, 0], [' READ ', 1], ['Write', 2], [' add ', 2], ['MANAGE', 3],
    ['edit', 3], ['FULL', 3], ['admin', 3], ['none', 0], ['3', 0],
    ['constructor', 0], ['toString', 0], [2.9, 2], [-1.9, 0], [99, 3], [NaN, 0], [Infinity, 0],
  ])('normalizes recorded %s to %s using the server vocabulary', (input, expected) => {
    expect(normalizeHistoryPermissionLevel(input)).toBe(expected)
  })

  it('combines role grants, custom overrides and all in server order', () => {
    const operator = { ...standard, role_id: 7, role_permissions: { assets: 3, all: 1 },
      custom_permissions: { ' assets ': 0 } }
    expect(recordedPermissionLevel(operator, 'assets')).toBe(1)
    expect(recordedPermissionLevel({ ...operator, custom_permissions: { all: 0, assets: 2 } }, 'assets')).toBe(2)
    expect(recordedPermissionLevel({ ...operator, custom_permissions: {} }, 'assets')).toBe(3)
  })

  it('keeps missing historical roles unknown and explicit absence known', () => {
    expect(recordedPermissionLevel({ is_admin: false, role_id: 7, custom_permissions: { assets: 3 } }, 'assets')).toBeNull()
    expect(recordedPermissionLevel({ is_admin: false, role_id: null, custom_permissions: { assets: true } }, 'assets')).toBe(1)
    expect(recordedPermissionLevel({ is_admin: false }, 'assets')).toBeNull()
    expect(recordedPermissionLevel(null, 'assets')).toBe(0)
  })

  it.each([[], 'all', 3, { assets: {} }, { assets: NaN }, { assets: 1, ' assets ': 3 }])('does not present malformed historical maps as no access: %s', value => {
    expect(hasCompleteHistoryPermissions({ ...standard, custom_permissions: value })).toBe(false)
    expect(recordedPermissionLevel({ ...standard, role_permissions: value }, 'assets')).toBeNull()
  })

  it('does not infer admin or grant the reserved system plane', () => {
    expect(recordedPermissionLevel({ ...standard, is_admin: 'true' }, 'assets')).toBeNull()
    expect(recordedPermissionLevel({ ...standard, is_admin: true }, 'assets')).toBe(3)
    expect(recordedPermissionLevel({ ...standard, is_admin: true, custom_permissions: { 'system.tenants': 3 } }, 'system.tenants')).toBe(0)
  })

  it('includes capabilities outside the current view list without treating all as a view', () => {
    expect(historyPermissionViews(['assets'], { ...standard, role_permissions: { all: 3, ' diagnostics ': 1 },
      custom_permissions: { diagnostics: 2, 'system.tenants': 3, '': 1 } }))
      .toEqual(['assets', 'diagnostics', 'system.tenants'])
  })

  it('preserves raw override changes while ignoring object insertion order', () => {
    expect(formatRecordedPermissions({ assets: 1, all: 3 })).toBe(formatRecordedPermissions({ all: 3, assets: 1 }))
    expect(formatRecordedPermissions({ assets: 1 })).not.toBe(formatRecordedPermissions({ assets: 2 }))
    expect(formatRecordedPermissions(undefined)).toBe('Not recorded')
    expect(formatRecordedPermissions({})).toBe('{}')
  })
})
