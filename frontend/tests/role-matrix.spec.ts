import { expect, test } from '@playwright/test'

const api = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

for (const role of ['viewer', 'editor'] as const) {
  test(`isolated ${role} identity receives its real asset permissions`, async ({ page, context }) => {
    const user = `sysgrid.verify.${role}`
    const headers = { 'X-User-Id': user, 'X-Tenant-Id': process.env.PW_TENANT_ID || '1' }
    await context.setExtraHTTPHeaders(headers)
    const response = await context.request.get(`${api}/policy/module-availability`, { headers })
    expect(response.status()).toBe(200)
    const policy = await response.json()
    expect(policy.identity).toMatchObject({ user_id: user, tenant_admin: false, system_root: false, access_role: role.toUpperCase() })
    expect(policy.modules.assets.actions).toMatchObject({ read: true, write: role === 'editor' })
    if (role === 'viewer') {
      const seed = await context.request.post(`${api}/devices`, { headers: { ...headers, 'X-User-Id': 'sysgrid.verify.editor' }, data: { name: 'ROLE-MATRIX-VIEWER-ROW', system: 'Role qualification', type: 'Physical', status: 'Active' } })
      expect(seed.ok(), await seed.text()).toBeTruthy()
    }
    await page.goto('/asset')
    await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible()
    const register = page.getByRole('button', { name: 'Register Asset', exact: true })
    if (role === 'viewer') {
      await expect(register).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Import asset rows', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Edit asset', exact: true }).first()).toBeDisabled()
      await page.getByTitle('More actions').first().click()
      await expect(page.getByRole('button', { name: 'Edit Configuration', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeDisabled()
    } else {
      await expect(register).toBeEnabled()
    }
    const name = `ROLE-MATRIX-${role}-${Date.now()}`
    const write = await context.request.post(`${api}/devices`, { headers, data: { name, system: 'Role qualification', type: 'Physical', status: 'Active' } })
    if (role === 'viewer') {
      expect(write.status()).toBe(403)
    } else {
      expect(write.ok(), await write.text()).toBeTruthy()
      const read = await context.request.get(`${api}/devices`, { headers })
      expect(read.status()).toBe(200)
      expect(JSON.stringify(await read.json())).toContain(name)
    }
    const otherTenant = await context.request.get(`${api}/devices`, { headers: { ...headers, 'X-Tenant-Id': '999999' } })
    expect(otherTenant.ok()).toBe(false)
  })
}


for (const surface of [
  { module: 'services', path: '/services', action: /Add Service/, endpoint: '/logical-services' },
  { module: 'monitoring', path: '/monitoring', action: /Add Monitoring/, endpoint: '/monitoring' },
  { module: 'network', path: '/network', action: /Add Connection/, endpoint: '/networks/connections' },
  { module: 'vendors', path: '/vendors', action: /Add Vendor/, endpoint: '/vendors' },
  { module: 'external', path: '/external', action: /Add External/, endpoint: '/intelligence/entities' },
  { module: 'far', path: '/far', action: /Add Failure Mode/, endpoint: '/far/modes' },
  { module: 'research', path: '/research', action: /Add Research/, endpoint: '/investigations' },
  { module: 'knowledge', path: '/knowledge', action: /New BKM/, endpoint: '/knowledge' },
]) {
  test(`viewer cannot create in ${surface.module}`, async ({ page, context }) => {
    const headers = { 'X-User-Id': 'sysgrid.verify.viewer', 'X-Tenant-Id': process.env.PW_TENANT_ID || '1' }
    await context.setExtraHTTPHeaders(headers)
    const policyResponse = await context.request.get(`${api}/policy/module-availability`, { headers })
    expect(policyResponse.status()).toBe(200)
    const policy = await policyResponse.json()
    expect(policy.identity).toMatchObject({ user_id: 'sysgrid.verify.viewer', tenant_admin: false, access_role: 'VIEWER' })
    expect(policy.modules[surface.module].actions).toMatchObject({ read: true, write: false })
    const denied = await context.request.post(`${api}${surface.endpoint}`, { headers, data: {} })
    expect(denied.status()).toBe(403)
    if (surface.module === 'monitoring') {
      const seeded = await context.request.post(`${api}/monitoring`, {
        headers: { ...headers, 'X-User-Id': 'sysgrid.verify.editor' },
        data: { category: 'Hardware', status: 'Existing', title: `ROLE-MATRIX-MONITOR-${Date.now()}` },
      })
      expect(seeded.ok(), await seeded.text()).toBeTruthy()
    }
    await page.goto(surface.path)
    if (surface.module === 'research' || surface.module === 'knowledge') {
      const moduleName = surface.module === 'research' ? 'Research' : 'Knowledge'
      await expect(page.getByRole('heading', { name: `${moduleName} is outside SysGrid`, exact: true })).toBeVisible()
    } else {
      await expect(page.getByRole('button', { name: surface.action }).first()).toBeDisabled()
    }
    if (surface.module === 'monitoring') {
      await expect(page.getByRole('button', { name: 'Import monitoring rows', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Edit configuration', exact: true }).first()).toBeDisabled()
      await page.getByTitle('Registry configuration').click()
      await expect(page.getByText('Monitoring Matrix Enumerations', { exact: true })).toBeVisible()
      await expect(page.getByTitle('This value is managed by the application.').first()).toBeDisabled()
    }
    if (surface.module === 'services') {
      await page.getByTitle('Registry configuration').click()
      await expect(page.getByText('Service Enumerations', { exact: true })).toBeVisible()
      await expect(page.getByTitle('Settings management permission is required.').first()).toBeDisabled()
    }
  })
  test(`editor can access create in ${surface.module}`, async ({ page, context }) => {
    const headers = { 'X-User-Id': 'sysgrid.verify.editor', 'X-Tenant-Id': process.env.PW_TENANT_ID || '1' }
    await context.setExtraHTTPHeaders(headers)
    const response = await context.request.get(`${api}/policy/module-availability`, { headers })
    expect(response.status()).toBe(200)
    const policy = await response.json()
    expect(policy.identity).toMatchObject({ user_id: 'sysgrid.verify.editor', tenant_admin: false, access_role: 'EDITOR' })
    expect(policy.modules[surface.module].actions).toMatchObject({ read: true, write: true })
    await page.goto(surface.path)
    if (surface.module === 'research' || surface.module === 'knowledge') {
      const moduleName = surface.module === 'research' ? 'Research' : 'Knowledge'
      await expect(page.getByRole('heading', { name: `${moduleName} is outside SysGrid`, exact: true })).toBeVisible()
    } else {
      await expect(page.getByRole('button', { name: surface.action }).first()).toBeEnabled()
    }
  })
}
