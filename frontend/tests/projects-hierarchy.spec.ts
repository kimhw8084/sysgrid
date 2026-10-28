import { test, expect, Page } from '@playwright/test'
import { PROJECTS_ROOT_PREVIEW_USER, projectsRootPreviewPolicy } from './helpers/projects-root-preview'

type Project = Record<string, any>

const makeProject = (id: number, name: string, parent_project_id: number | null = null): Project => ({
  id,
  name,
  parent_project_id,
  status: 'In Progress',
  priority: 'High',
  owner: `Owner ${id}`,
  objective: `Independent outcome ${id}`,
  expected_outcomes: [`Outcome ${id} is accepted`],
  start_date: '2026-09-01',
  end_date: '2026-10-01',
  metadata_json: {},
  tasks: [],
})

const topLevel = Array.from({ length: 10 }, (_, index) => makeProject(81001 + index, `P${String(index + 1).padStart(2, '0')} — Outcome ${index + 1}`))
const p10 = topLevel[9]
const p10Child = makeProject(81011, 'P10 — Atlas Site B Enablement', p10.id)
const projects = [...topLevel, p10Child]

const installRoutes = async (page: Page) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() === 'GET' && path.endsWith('/settings/bootstrap')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ VITE_API_BASE_URL: url.origin, DEFAULT_USER_ID: PROJECTS_ROOT_PREVIEW_USER }) })
    }
    if (request.method() === 'GET' && path === '/api/v1/policy/module-availability') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projectsRootPreviewPolicy) })
    if (request.method() === 'GET' && path === '/api/v1/settings/user/profile') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: PROJECTS_ROOT_PREVIEW_USER, username: PROJECTS_ROOT_PREVIEW_USER, full_name: 'Projects Root Preview', is_admin: false, permissions: {} }) })
    }
    if (request.method() === 'GET' && path === '/api/v1/settings/user/settings') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme: 'nordic-frost-v1' }) })
    }
    if (request.method() === 'GET' && path === '/api/v1/health') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
    }
    if (request.method() === 'GET' && path === '/api/v1/projects') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projects) })
    }
    if (request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    if ((request.method() === 'PUT' || request.method() === 'POST') && path.startsWith('/api/v1/projects')) {
      const body = request.postDataJSON?.() || {}
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: body.id || 81999, ...body, tasks: body.tasks || [] }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((userId) => {
    localStorage.setItem('sysgrid-theme', 'nordic-frost-v1')
    localStorage.setItem('SYSGRID_USER_ID', userId)
  }, PROJECTS_ROOT_PREVIEW_USER)
  await installRoutes(page)
})

test('P10 hierarchy rehearsal shows ten roots and one nested child @hierarchy-rehearsal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/projects?id=${p10.id}&view=overview`)
  await expect(page.locator('[data-workspace="projects"]')).toBeVisible()
  await expect(page.locator('[data-project-hierarchy-depth="0"]')).toHaveCount(10)
  await expect(page.locator('[data-project-subproject="true"]')).toHaveCount(1)
  await expect(page.locator('[data-project-subproject="true"]')).toContainText('Atlas Site B Enablement')
  await expect(page.locator('[data-project-child-count="true"]')).toContainText('1 nested subproject')
})

test('child deep link restores explicit parent context @hierarchy-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/projects?id=${p10Child.id}&view=overview`)
  const context = page.locator('[data-project-parent-context="true"]')
  await expect(context).toBeVisible()
  await expect(context).toContainText(p10.name)
  await expect(context).toContainText(p10Child.name)
  await expect(page.getByRole('heading', { name: p10Child.name })).toBeVisible()
})

test('portfolio counts only top-level outcomes and excludes child card @hierarchy-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/projects?view=portfolio&section=control')
  await expect(page.locator('[data-project-control-tower="true"]')).toBeVisible()
  await expect(page.getByText('10 active', { exact: true })).toBeVisible()
  await expect(page.locator('[data-project-control-tower="true"]')).not.toContainText(p10Child.name)
})

test('create flow exposes top-level versus subproject semantics with required parent chooser @hierarchy-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/projects?id=${p10.id}&view=overview`)
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-project-outcome-form="true"]')).toBeVisible()
  await dialog.getByRole('button', { name: 'Subproject', exact: false }).click()
  const parent = dialog.getByRole('combobox', { name: 'Parent Project' })
  await expect(parent).toBeVisible()
  await parent.selectOption(String(p10.id))
  await expect(parent).toHaveValue(String(p10.id))
  await expect(dialog.getByRole('textbox', { name: 'MVP / outcome' })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Definition of done / success measures' })).toBeVisible()
})

test('edit child flow restores parent selection and can explicitly promote to top level @hierarchy-acceptance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/projects?id=${p10Child.id}&view=overview`)
  await page.getByRole('button', { name: 'Edit outcome', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const parent = dialog.getByRole('combobox', { name: 'Parent Project' })
  await expect(parent).toHaveValue(String(p10.id))
  await dialog.getByRole('button', { name: 'Top-level Project', exact: false }).click()
  await expect(parent).toHaveCount(0)
  await expect(dialog).toContainText('only Projects counted as independent portfolio outcomes')
})
