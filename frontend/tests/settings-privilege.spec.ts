import { expect, test, type Page, type Route } from '@playwright/test'

type Fixture = {
  userId: string
  tenantAdmin: boolean
  settingsManage: boolean
  diagnosticsRead: boolean
  controlPlaneAdmin: boolean
  profileIsAdmin?: boolean
}

const settingsModule = (settingsManage: boolean) => ({
  module_id: 'settings',
  label: 'Settings / Access',
  stage: 'production',
  default_stage: 'production',
  available: true,
  blocked_reason: null,
  root_preview: false,
  actions: {
    read: true,
    write: settingsManage,
    manage: settingsManage,
    import: settingsManage,
    export: true,
    preview: false,
  },
})

const policyFor = (fixture: Fixture) => ({
  catalog_version: 'test',
  profile_id: 'test',
  identity: {
    authenticated: true,
    tenant_id: 1,
    access_role: fixture.tenantAdmin ? 'ADMIN' : 'VIEWER',
    operator_role: fixture.tenantAdmin ? 'Admin' : 'Viewer',
    tenant_admin: fixture.tenantAdmin,
    system_root: false,
    control_plane_admin: fixture.controlPlaneAdmin,
  },
  actions: { diagnostics: { read: fixture.diagnosticsRead } },
  modules: { settings: settingsModule(fixture.settingsManage) },
})

async function installFixture(page: Page, fixture: Fixture) {
  const requests: string[] = []
  await page.addInitScript((userId) => {
    window.localStorage.setItem('SYSGRID_USER_ID', userId)
    window.localStorage.setItem('SYSGRID_CONFIG_DEFAULT_USER_ID', userId)
  }, fixture.userId)
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    requests.push(`${request.method()} ${path}`)

    let payload: unknown = {}
    if (path.endsWith('/settings/bootstrap')) {
      payload = { VITE_API_BASE_URL: url.origin, DEFAULT_USER_ID: fixture.userId }
    } else if (path.endsWith('/policy/module-availability')) {
      payload = policyFor(fixture)
    } else if (path.endsWith('/settings/user/profile')) {
      payload = {
        username: fixture.userId,
        full_name: fixture.userId,
        is_admin: fixture.profileIsAdmin ?? fixture.tenantAdmin,
        permissions: fixture.settingsManage ? { settings: 3 } : { settings: 1 },
      }
    } else if (path.endsWith('/settings/user/settings')) {
      payload = {}
    } else if (path.endsWith('/settings/options') || path.endsWith('/settings/operators') || path.endsWith('/settings/teams') || path.endsWith('/tenants/me')) {
      payload = []
    } else if (path.endsWith('/settings/global')) {
      payload = { _metadata: {}, _deployment: {} }
    } else if (path.endsWith('/tenants/admin/all') || path.endsWith('/tenants/admin/settings')) {
      payload = []
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
  return requests
}

function hasRequest(requests: string[], fragment: string) {
  return requests.some((request) => request.includes(fragment))
}

test.describe('Settings authoritative privilege matrix', () => {
  test('reader keeps personal Parameters/Standards and emits no privileged background requests', async ({ page }) => {
    const requests = await installFixture(page, {
      userId: 'settings-reader',
      tenantAdmin: false,
      settingsManage: false,
      diagnosticsRead: false,
      controlPlaneAdmin: false,
    })

    await page.goto('/settings?tab=diagnostics&proof=reader')
    await expect(page.getByText('Personal Preferences')).toBeVisible()
    await expect(page.locator('#sg-main-content').getByRole('button', { name: 'Light', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Standards', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Permissions', exact: true })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'System Diagnostics', exact: true })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Tenants', exact: true })).not.toBeVisible()
    await expect(page).toHaveURL(/\/settings\?tab=environments&proof=reader$/)
    await expect(page.getByText('Global configuration unavailable')).toBeVisible()
    expect(hasRequest(requests, '/settings/global')).toBe(false)
    expect(hasRequest(requests, '/settings/user-pool/versions')).toBe(false)
    expect(hasRequest(requests, '/tenants/admin/')).toBe(false)
    expect(hasRequest(requests, '/settings/startup-check')).toBe(false)
    expect(hasRequest(requests, '/settings/user/env-vars')).toBe(false)
  })

  test('tenant admin with Settings manage remains separate from diagnostics and control-plane authority', async ({ page }) => {
    const requests = await installFixture(page, {
      userId: 'tenant-admin',
      tenantAdmin: true,
      settingsManage: true,
      diagnosticsRead: false,
      controlPlaneAdmin: false,
      profileIsAdmin: true,
    })

    await page.goto('/settings?tab=diagnostics&proof=tenant-admin')
    await expect(page.getByRole('button', { name: 'Permissions', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Groups', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Metadata', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Analysis', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'System Diagnostics', exact: true })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Tenants', exact: true })).not.toBeVisible()
    await expect(page).toHaveURL(/\/settings\?tab=environments&proof=tenant-admin$/)
    expect(hasRequest(requests, '/settings/global')).toBe(true)
    expect(hasRequest(requests, '/tenants/admin/')).toBe(false)

    await page.goto('/settings?tab=tenants&proof=tenant-admin')
    await expect(page.getByText('Personal Preferences')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tenants', exact: true })).not.toBeVisible()
    await expect(page).toHaveURL(/\/settings\?tab=environments&proof=tenant-admin$/)
    expect(hasRequest(requests, '/settings/global')).toBe(true)
    expect(hasRequest(requests, '/tenants/admin/')).toBe(false)
  })

  test('explicit diagnostics and control-plane policy independently mount their protected views', async ({ page }) => {
    const requests = await installFixture(page, {
      userId: 'deployment-admin',
      tenantAdmin: true,
      settingsManage: true,
      diagnosticsRead: true,
      controlPlaneAdmin: true,
      profileIsAdmin: false,
    })

    await page.goto('/settings?tab=diagnostics')
    await expect(page.getByText('Browser-runtime deployment diagnostics').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tenants', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'System Diagnostics', exact: true })).toBeVisible()
    expect(hasRequest(requests, '/tenants/admin/')).toBe(false)

    await page.goto('/settings?tab=tenants')
    await expect(page.getByText('Tenant Registry')).toBeVisible()
    expect(hasRequest(requests, '/tenants/admin/all')).toBe(true)
    expect(hasRequest(requests, '/tenants/admin/settings')).toBe(true)
  })
})
