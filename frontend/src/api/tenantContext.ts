/** Pin tenant context to this tab. Another tab may change the new-tab default. */
const TAB_KEY = 'SYSGRID_TAB_TENANT_ID'
const DEFAULT_KEY = 'SYSGRID_TENANT_ID'
let pendingWrites = 0
let switching = false

export function captureTenantPreference() {
  return { tab: sessionStorage.getItem(TAB_KEY), fallback: localStorage.getItem(DEFAULT_KEY) }
}

export function initializeTenantContext(
  tenants: Array<{ id: number; is_selected?: boolean; is_online?: boolean }>,
  preference: ReturnType<typeof captureTenantPreference>,
): void {
  // An established tab never changes scope implicitly, including after access
  // revocation. Only a fresh tab resolves a default from authorized memberships.
  const preferred = preference.tab || tenants.find(tenant => String(tenant.id) === preference.fallback)?.id
  const selected = preferred || tenants.find(tenant => tenant.is_selected)?.id || tenants[0]?.id
  if (selected) sessionStorage.setItem(TAB_KEY, String(selected))
}

export function getCurrentTenantId(): string {
  let tenant = sessionStorage.getItem(TAB_KEY)
  if (!tenant) {
    tenant = localStorage.getItem(DEFAULT_KEY) || '1'
    sessionStorage.setItem(TAB_KEY, tenant)
  }
  return tenant
}

export function selectCurrentTenant(tenantId: number): void {
  sessionStorage.setItem(TAB_KEY, String(tenantId))
  // This tab is authoritative. A blocked shared preference must not turn a
  // successful switch into a false failure after the tab has changed scope.
  try { localStorage.setItem(DEFAULT_KEY, String(tenantId)) } catch { /* optional new-tab default */ }
}

export function beginTenantSwitch(): () => void {
  if (switching || pendingWrites) throw new Error('Wait for the current save to finish before switching tenants.')
  // Check that the tab can retain its context before any server mutation.
  sessionStorage.setItem(TAB_KEY, getCurrentTenantId())
  switching = true
  return () => { switching = false }
}

export function beginScopedWrite(isTenantSelection: boolean): () => void {
  if (switching && !isTenantSelection) throw new Error('A tenant switch is in progress. This change was not sent.')
  pendingWrites++
  return () => { pendingWrites-- }
}
