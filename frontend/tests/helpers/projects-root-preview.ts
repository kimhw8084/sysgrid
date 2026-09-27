import type { Page } from '@playwright/test'

export const PROJECTS_ROOT_PREVIEW_USER = 'sysgrid_r2_root_fixture'

export const projectsRootPreviewPolicy = {
  catalog_version: 'task-integrity-proof',
  profile_id: PROJECTS_ROOT_PREVIEW_USER,
  identity: {
    authenticated: true,
    tenant_id: 1,
    access_role: 'System Root',
    operator_role: null,
    tenant_admin: false,
    system_root: true,
    control_plane_admin: true,
  },
  actions: {},
  modules: {
    projects: {
      module_id: 'projects',
      label: 'Projects',
      stage: 'preview',
      default_stage: 'preview',
      available: true,
      blocked_reason: null,
      root_preview: true,
      actions: { read: true, write: true, manage: true, import: true, export: true, preview: true },
    },
  },
}

export async function installProjectsRootPreviewApis(page: Page) {
  await page.addInitScript((userId) => {
    localStorage.setItem('SYSGRID_USER_ID', userId)
  }, PROJECTS_ROOT_PREVIEW_USER)
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() === 'POST' && path === '/api/v1/observability/performance') return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true }) })
    if (request.method() === 'GET' && path.endsWith('/settings/bootstrap')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ VITE_API_BASE_URL: url.origin, DEFAULT_USER_ID: PROJECTS_ROOT_PREVIEW_USER }) })
    if (request.method() === 'GET' && path === '/api/v1/policy/module-availability') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projectsRootPreviewPolicy) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/profile') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: PROJECTS_ROOT_PREVIEW_USER, username: PROJECTS_ROOT_PREVIEW_USER, full_name: 'Synthetic Root Preview Proof', is_admin: false, permissions: {} }) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/settings') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme: 'nordic-frost-v1' }) })
    if (request.method() === 'GET' && path === '/api/v1/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
    if (request.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}
