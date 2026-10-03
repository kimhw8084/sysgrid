import { beforeEach, describe, expect, it } from 'vitest'
import { captureTenantPreference, getCurrentTenantId, initializeTenantContext } from './tenantContext'

describe('initial tenant scope', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

  it('uses the authorized server selection before loading a fresh workspace', () => {
    const preference = captureTenantPreference()
    // A bootstrap request may temporarily use the legacy fallback header.
    expect(getCurrentTenantId()).toBe('1')
    initializeTenantContext([{ id: 7, is_selected: true }], preference)
    expect(getCurrentTenantId()).toBe('7')
    expect(localStorage.getItem('SYSGRID_TENANT_ID')).toBeNull()
  })

  it('keeps an accessible new-tab preference ahead of another tab server selection', () => {
    localStorage.setItem('SYSGRID_TENANT_ID', '7')
    initializeTenantContext([{ id: 7 }, { id: 8, is_selected: true }], captureTenantPreference())
    expect(getCurrentTenantId()).toBe('7')
  })

  it('ignores an inaccessible shared default for a fresh tab', () => {
    localStorage.setItem('SYSGRID_TENANT_ID', '1')
    initializeTenantContext([{ id: 7 }], captureTenantPreference())
    expect(getCurrentTenantId()).toBe('7')
  })

  it('never silently retargets an established tab after membership revocation', () => {
    sessionStorage.setItem('SYSGRID_TAB_TENANT_ID', '7')
    localStorage.setItem('SYSGRID_TENANT_ID', '8')
    initializeTenantContext([{ id: 8, is_selected: true }], captureTenantPreference())
    expect(getCurrentTenantId()).toBe('7')
  })

  it('does not invent a membership or overwrite preferences when none are available', () => {
    initializeTenantContext([], captureTenantPreference())
    expect(sessionStorage.getItem('SYSGRID_TAB_TENANT_ID')).toBeNull()
    expect(localStorage.getItem('SYSGRID_TENANT_ID')).toBeNull()
  })
})
