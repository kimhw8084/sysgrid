import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const apiOrigin = apiBase.replace(/\/api\/v1$/, '')
const testUserId = process.env.USER_ID || 'haewon.kim'
export const testTenantId = process.env.PW_TENANT_ID || '1'
export const testApiHeaders: Record<string, string> = {
  'X-User-Id': testUserId,
  'X-Tenant-Id': testTenantId,
}
export type WorkspaceId = 'monitoring' | 'network' | 'assets' | 'vendors'
export type LogicalGridRow = {
  rowKey: string
  pinned: Locator | null
  center: Locator | null
  cell: (columnId: string) => Promise<Locator>
  action: (name: string | RegExp) => Locator
}

const browserStateKeys = [
  'monitoring_workspace_state_v2',
  'asset_real_workspace_state_v1',
  'network_workspace_state_v1',
  'services_workspace_state_v1',
  'vendor_workspace_state_v1',
  'monitoring_ui_state',
  'asset_ui_state',
  'project_ui_state',
  'far_ui_state',
  'rca_ui_state',
  'investigation_ui_state',
  'settings_ui_state',
  'sysgrid_monitoring_views_v1',
  'sysgrid_monitoring_active_view_v1',
  'sysgrid_monitoring_favorites_v1',
  'sysgrid_monitoring_ui_state_v1',
  'sysgrid_monitoring_watch_v1',
  'sysgrid_monitoring_session_init',
].join('|')

async function post(request: APIRequestContext, path: string, data: Record<string, any>) {
  const response = await request.post(`${apiBase}${path}`, { 
    data,
    headers: testApiHeaders
  })
  if (!response.ok()) {
     const text = await response.text()
     console.error(`POST ${path} FAILED: ${response.status()} ${text}`)
  }
  expect(response.ok()).toBeTruthy()
  const resData = await response.json()
  if (path === '/monitoring') {
     console.log(`SEED: Created monitoring item "${resData.title}" (ID: ${resData.id})`)
  }
  return resData
}

async function put(request: APIRequestContext, path: string, data: Record<string, any>) {
  const response = await request.put(`${apiBase}${path}`, { 
    data,
    headers: testApiHeaders
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

async function get(request: APIRequestContext, path: string) {
  const response = await request.get(`${apiBase}${path}`, {
    headers: testApiHeaders
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

export async function ensureSettingOption(
  request: APIRequestContext,
  category: string,
  value: string,
  label = value,
) {
  const options = await get(request, `/settings/options?category=${encodeURIComponent(category)}`)
  const existing = Array.isArray(options)
    ? options.find((option: Record<string, any>) => option.value === value || option.label === label)
    : null
  if (existing) return existing
  return post(request, '/settings/options', { category, value, label })
}

export async function requireSettingOption(
  request: APIRequestContext,
  category: string,
  value: string,
  label = value,
) {
  const options = await get(request, `/settings/options?category=${encodeURIComponent(category)}`)
  const existing = Array.isArray(options)
    ? options.find((option: Record<string, any>) => option.value === value || option.label === label)
    : null
  expect(existing, `Expected code-managed setting option ${category}:${value}`).toBeTruthy()
  return existing
}

export async function resetBrowserState(page: Page) {
  const testResetToken = `pw-reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const cleanState = {
    savedViews: [],
    activeViewId: null,
    favoriteIds: [],
    watchIds: [],
    uiState: {
      activeTab: 'active',
      fontSize: 11,
      rowDensity: 8,
      hiddenColumns: [],
      quickFilters: { status: [], severity: [], platform: [], owner: [] },
      groupBy: 'raw',
      showFilterBar: true,
      columnLayoutState: [],
      lastVisitedAt: 0,
      searchTerm: '',
    }
  }

  // Clear backend user settings
  try {
    await page.request.post(`${apiBase}/settings/user/settings`, {
      data: {
        monitoring_workspace_state_v2: cleanState,
        asset_real_workspace_state_v1: cleanState,
        network_workspace_state_v1: cleanState,
        services_workspace_state_v1: cleanState,
        vendor_workspace_state_v1: cleanState,
        monitoring_ui_state: null,
        asset_ui_state: null,
        project_ui_state: null,
        far_ui_state: null,
        rca_ui_state: null,
        investigation_ui_state: null,
        settings_ui_state: null,
      },
      headers: testApiHeaders
    })
  } catch (e) {
    console.error('Failed to clear backend settings:', e)
  }

  // Direct clean up of localStorage and sessionStorage on the app origin
  try {
    await page.goto('/')
    await page.evaluate(() => {
      const keysToRemove = Object.keys(window.localStorage).filter((key) => (
        key.startsWith('sysgrid_') || key.startsWith('SYSGRID_') || key.startsWith('__sysgrid_')
      ))
      keysToRemove.forEach((key) => window.localStorage.removeItem(key))
      Object.keys(window.sessionStorage)
        .filter((key) => key.startsWith('sysgrid_') || key.startsWith('__sysgrid_'))
        .forEach((key) => window.sessionStorage.removeItem(key))
    })
  } catch (e) {
    // ignore
  }

  await page.addInitScript(({ injectedApiOrigin, resetToken, tenantId, userId, workspaceStateKeys }) => {
    const workspaceKeys = new Set(workspaceStateKeys.split('|'))
    const removeWorkspaceState = (storage: Storage) => {
      Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter((key): key is string => Boolean(key) && workspaceKeys.has(key))
        .forEach((key) => storage.removeItem(key))
    }
    const appliedToken = window.sessionStorage.getItem('__sysgrid_pw_bootstrap__')
    if (!appliedToken || appliedToken !== resetToken) {
      removeWorkspaceState(window.localStorage)
      removeWorkspaceState(window.sessionStorage)
      window.sessionStorage.setItem('__sysgrid_pw_bootstrap__', resetToken)
    }
    window.localStorage.setItem('SYSGRID_OVERRIDE_API_URL', injectedApiOrigin)
    window.localStorage.setItem('SYSGRID_TENANT_ID', tenantId)
    window.localStorage.setItem('SYSGRID_USER_ID', userId)
  }, { injectedApiOrigin: apiOrigin, resetToken: testResetToken, tenantId: testTenantId, userId: testUserId, workspaceStateKeys: browserStateKeys })
}

export async function createAsset(request: APIRequestContext, payload: Record<string, any>) {
  return post(request, '/devices', payload)
}

export async function createFarCause(request: APIRequestContext, payload: Record<string, any>) {
  return post(request, '/far/causes', payload)
}

export async function createFarMode(request: APIRequestContext, payload: Record<string, any>) {
  return post(request, '/far/modes', payload)
}

export async function createFarMitigation(request: APIRequestContext, payload: Record<string, any>) {
  return post(request, '/far/mitigations', payload)
}

export async function createInvestigation(request: APIRequestContext, payload: Record<string, any>) {
  return post(request, '/investigations', payload)
}

export async function updateFarMode(request: APIRequestContext, modeId: number, payload: Record<string, any>) {
  return put(request, `/far/modes/${modeId}`, payload)
}

export async function createConnection(request: APIRequestContext, payload: Record<string, any>) {
  return post(request, '/networks/connections', payload)
}

export async function createExternalEntity(request: APIRequestContext, payload: Record<string, any>) {
  if (!payload.internal_team_id && !payload.internal_operator_id) {
    const operators = await get(request, '/settings/operators')
    payload = {
      ownership_mode: 'individual',
      internal_operator_id: operators[0]?.id,
      contacts_json: [
        {
          role: 'Primary',
          full_name: 'Primary Contact',
          email: 'primary.contact@example.com',
          phone: '+1-555-0100',
          external_person_id: 'primary-contact',
          is_primary: true,
          is_escalation: false,
        },
      ],
      business_purpose: 'External dependency support',
      criticality: 'Low',
      dependency_tier: 'Tier 3',
      integration_mode: payload.type === 'API' ? 'API' : 'Manual',
      auth_method: payload.type === 'API' ? 'Token' : 'Manual',
      primary_endpoint_url: payload.type === 'API' ? 'https://partner.example.com' : undefined,
      risk_rating: 'Low',
      ...payload,
    }
  }
  return post(request, '/intelligence/entities', payload)
}

export async function addExternalSecret(request: APIRequestContext, entityId: number, payload: Record<string, any>) {
  return post(request, `/intelligence/entities/${entityId}/secrets`, payload)
}

export async function createProject(request: APIRequestContext, payload: Record<string, any>) {
  return post(request, '/projects', payload)
}

export async function updateProject(request: APIRequestContext, projectId: number, payload: Record<string, any>) {
  return put(request, `/projects/${projectId}`, payload)
}

export async function createService(request: APIRequestContext, payload: Record<string, any>) {
  return post(request, '/logical-services', payload)
}

export async function createMonitoring(request: APIRequestContext, payload: Record<string, any>) {
  let nextPayload = { ...payload }

  if (typeof nextPayload.category === 'string' && nextPayload.category.trim()) {
    await requireSettingOption(request, 'MonitoringCategory', nextPayload.category.trim())
  }
  if (typeof nextPayload.platform === 'string' && nextPayload.platform.trim()) {
    await ensureSettingOption(request, 'MonitoringPlatform', nextPayload.platform.trim())
  }
  if (typeof nextPayload.notification_method === 'string' && nextPayload.notification_method.trim()) {
    await ensureSettingOption(request, 'NotificationMethod', nextPayload.notification_method.trim())
  }

  const ensureOwnershipSeed = async () => {
    let teams = await get(request, '/settings/teams').catch(() => [])
    let operators = await get(request, '/settings/operators').catch(() => [])

    if (!teams.length) {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const team = await post(request, '/settings/teams', {
        name: `PW Team ${stamp}`,
        description: 'Playwright monitoring ownership seed',
      })
      teams = [team]
    }

    if (!operators.length) {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const op1 = await post(request, '/settings/operators', {
        external_id: `pw1-${stamp}`,
        username: `pw1_${stamp}`,
        full_name: `Playwright Operator 1 ${stamp}`,
        email: `pw1-${stamp}@sysgrid.test`,
        department: 'Operations',
        team_id: teams[0]?.id,
      })
      const op2 = await post(request, '/settings/operators', {
        external_id: `pw2-${stamp}`,
        username: `pw2_${stamp}`,
        full_name: `Playwright Operator 2 ${stamp}`,
        email: `pw2-${stamp}@sysgrid.test`,
        department: 'Operations',
        team_id: teams[0]?.id,
      })
      operators = [op1, op2]
    }

    return { teams, operators }
  }

  if (Array.isArray(nextPayload.owners) && nextPayload.owners.length > 0 && !nextPayload.owners.every((owner: Record<string, any>) => owner.operator_id)) {
    const { operators } = await ensureOwnershipSeed()
    nextPayload = {
      ...nextPayload,
      owner_team: '',
      owners: nextPayload.owners.slice(0, operators.length).map((owner: Record<string, any>, index: number) => ({
        operator_id: operators[index].id,
        role: owner.role || 'Primary Support',
      })),
    }
  }

  if (!nextPayload.owner_team && (!Array.isArray(nextPayload.owners) || nextPayload.owners.length === 0)) {
    const { teams, operators } = await ensureOwnershipSeed()
    if (teams[0]?.name) {
      nextPayload = {
        ...nextPayload,
        owner_team: teams[0].name,
        owners: [],
      }
    } else {
      nextPayload = {
        ...nextPayload,
        owner_team: '',
        owners: operators[0]?.id
          ? [{ operator_id: operators[0].id, role: 'Primary Support' }]
          : [],
      }
    }
  }

  return post(request, '/monitoring', nextPayload)
}

export async function updateService(request: APIRequestContext, serviceId: number, payload: Record<string, any>) {
  return put(request, `/logical-services/${serviceId}`, payload)
}

export async function updateConnection(request: APIRequestContext, connectionId: number, payload: Record<string, any>) {
  return put(request, `/networks/connections/${connectionId}`, payload)
}

export async function createSite(request: APIRequestContext, payload: Record<string, any>) {
  return post(request, '/sites', payload)
}

export async function createRack(request: APIRequestContext, payload: Record<string, any>) {
  return post(request, '/racks', payload)
}

export async function createEmbeddedKnowledgeFixture(
  request: APIRequestContext,
  deviceId: number,
  title: string,
) {
  if (process.env.SYSGRID_VERIFY_PROFILE === 'normal-v1' && process.env.SYSGRID_VERIFY_TENANT_DB) {
    const python = process.env.SYSGRID_VERIFY_PYTHON_BIN || 'python3'
    const script = path.resolve(process.cwd(), '../scripts/seed-e2e-embedded-knowledge.py')
    const output = execFileSync(python, [
      script,
      '--db-path', process.env.SYSGRID_VERIFY_TENANT_DB,
      '--device-id', String(deviceId),
      '--title', title,
      '--created-by', testUserId,
    ], { encoding: 'utf8', env: process.env })
    return JSON.parse(output.trim())
  }
  return post(request, '/knowledge', {
    category: 'BKM',
    title,
    content: 'Recovery procedure',
    tags: ['Playwright'],
    linked_device_ids: [deviceId],
  })
}

export async function createEmbeddedFarFixture(
  request: APIRequestContext,
  deviceId: number,
  systemName: string,
  title: string,
) {
  if (process.env.SYSGRID_VERIFY_PROFILE === 'normal-v1' && process.env.SYSGRID_VERIFY_TENANT_DB) {
    const python = process.env.SYSGRID_VERIFY_PYTHON_BIN || 'python3'
    const script = path.resolve(process.cwd(), '../scripts/seed-e2e-embedded-far.py')
    const output = execFileSync(python, [
      script,
      '--db-path', process.env.SYSGRID_VERIFY_TENANT_DB,
      '--device-id', String(deviceId),
      '--system-name', systemName,
      '--title', title,
      '--created-by', testUserId,
    ], { encoding: 'utf8', env: process.env })
    return JSON.parse(output.trim())
  }
  return post(request, '/far/modes', {
    system_name: systemName,
    title,
    effect: 'Simulated failure mode',
    severity: 8,
    occurrence: 4,
    detection: 3,
    affected_assets: [deviceId],
  })
}

export async function mountRackDevice(request: APIRequestContext, rackId: number, payload: Record<string, any>) {
  return post(request, `/racks/${rackId}/mount`, payload)
}

export async function seedOperationalScenario(request: APIRequestContext) {
  const stamp = Date.now()
  const nonce = `${stamp}-${Math.random().toString(36).slice(2, 8)}`
  const ipSeed = stamp % 200
  const systemName = `PW-SYS-${nonce}`

  const primary = await createAsset(request, {
    name: `PW-ASSET-A-${nonce}`,
    system: systemName,
    status: 'Maintenance',
    model: 'R740',
    type: 'Physical',
    serial_number: `PW-SN-A-${nonce}`,
    asset_tag: `PW-TAG-A-${nonce}`,
    owner: '',
    business_unit: 'Operations',
    primary_ip: `10.0.${ipSeed}.10`,
    management_ip: `10.0.${ipSeed}.11`
  })

  const secondary = await createAsset(request, {
    name: `PW-ASSET-B-${nonce}`,
    system: systemName,
    status: 'Active',
    model: 'R740',
    type: 'Physical',
    serial_number: `PW-SN-B-${nonce}`,
    asset_tag: `PW-TAG-B-${nonce}`,
    owner: 'admin_root',
    business_unit: 'Operations',
    primary_ip: `10.0.${ipSeed}.12`,
    management_ip: `10.0.${ipSeed}.13`,
    environment: 'Staging'
  })

  const tertiary = await createAsset(request, {
    name: `PW-ASSET-C-${nonce}`,
    system: systemName,
    status: 'Active',
    model: 'R740',
    type: 'Physical',
    serial_number: `PW-SN-C-${nonce}`,
    asset_tag: `PW-TAG-C-${nonce}`,
    owner: 'admin_root',
    business_unit: 'Operations',
    primary_ip: `10.0.${ipSeed}.14`,
    management_ip: `10.0.${ipSeed}.15`,
    environment: 'Development'
  })

  const service = await post(request, '/logical-services', {
    name: `PW-SVC-${nonce}`,
    service_type: 'Database',
    status: 'Active',
    version: '16.0',
    environment: 'Production',
    device_id: primary.id,
    purpose: 'Playwright validation service'
  })

  const knowledge = await createEmbeddedKnowledgeFixture(request, primary.id, `PW-RUNBOOK-${nonce}`)

  const monitoring = await createMonitoring(request, {
    device_id: primary.id,
    category: 'Hardware',
    status: 'Existing',
    title: `PW-MON-${nonce}`,
    platform: 'Zabbix',
    purpose: 'Playwright validation',
    impact: 'Simulated degradation path',
    notification_method: 'Slack',
    severity: 'Critical',
    recovery_docs: [knowledge.id]
  })

  const maintenance = await post(request, '/maintenance', {
    device_id: primary.id,
    title: `PW-MAINT-${nonce}`,
    start_time: '2030-01-01T00:00:00Z',
    end_time: '2030-01-01T02:00:00Z',
    ticket_number: `PW-CHG-${nonce}`,
    coordinator: 'Playwright',
    status: 'Scheduled'
  })

  const far = await createEmbeddedFarFixture(request, primary.id, systemName, `PW-FAR-${nonce}`)

  return { stamp: nonce, systemName, primary, secondary, tertiary, service, knowledge, monitoring, maintenance, far }
}

export async function seedRackScenario(request: APIRequestContext) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const siteA = await createSite(request, {
    name: `PW-RACK-SITE-A-${stamp}`,
    address: 'Primary hall',
    color: '#2563eb'
  })
  const siteB = await createSite(request, {
    name: `PW-RACK-SITE-B-${stamp}`,
    address: 'Secondary hall',
    color: '#059669'
  })

  const rackA1 = await createRack(request, {
    site_id: siteA.id,
    name: `PW-RACK-A1-${stamp}`,
    aisle: 'A',
    row: '1',
    total_u: 12,
    max_power_kw: 10
  })
  const rackA2 = await createRack(request, {
    site_id: siteA.id,
    name: `PW-RACK-A2-${stamp}`,
    aisle: 'A',
    row: '1',
    total_u: 12,
    max_power_kw: 10
  })
  const rackBConflict = await createRack(request, {
    site_id: siteB.id,
    name: rackA1.name,
    aisle: 'B',
    row: '1',
    total_u: 12,
    max_power_kw: 10
  })

  const devicePrimary = await createAsset(request, {
    name: `PW-RACK-DEV-A-${stamp}`,
    system: `PW-RACK-SYS-${stamp}`,
    status: 'Active',
    model: 'R640',
    type: 'Physical',
    serial_number: `PW-RACK-SN-A-${stamp}`,
    asset_tag: `PW-RACK-TAG-A-${stamp}`,
    owner: 'rack-owner',
    business_unit: 'Operations'
  })
  const deviceSecondary = await createAsset(request, {
    name: `PW-RACK-DEV-B-${stamp}`,
    system: `PW-RACK-SYS-${stamp}`,
    status: 'Active',
    model: 'R640',
    type: 'Physical',
    serial_number: `PW-RACK-SN-B-${stamp}`,
    asset_tag: `PW-RACK-TAG-B-${stamp}`,
    owner: 'rack-owner',
    business_unit: 'Operations'
  })

  await mountRackDevice(request, rackA1.id, {
    device_id: devicePrimary.id,
    start_u: 1,
    size_u: 2,
    orientation: 'Front',
    depth: 'Full'
  })

  return { stamp, siteA, siteB, rackA1, rackA2, rackBConflict, devicePrimary, deviceSecondary }
}

export async function getColumnWidth(page: Page, colId: string): Promise<number> {
  return page.evaluate((id) => {
    // @ts-ignore
    const api = window.__MONITORING_GRID_API__ || window.__ASSET_GRID_API__ || window.__PROJECT_GRID_API__ || window.__DEBUG_NETWORK_GRID_API__
    if (!api) return 0
    const col = api.getColumnState().find((c: any) => c.colId === id)
    return col ? col.width : 0
  }, colId)
}

export async function isColumnVisible(page: Page, colId: string): Promise<boolean> {
  return page.evaluate((id) => {
    // @ts-ignore
    const api = window.__MONITORING_GRID_API__ || window.__ASSET_GRID_API__ || window.__PROJECT_GRID_API__ || window.__DEBUG_NETWORK_GRID_API__
    if (!api) return false
    const col = api.getColumnState().find((c: any) => c.colId === id)
    return col ? !col.hide : false
  }, colId)
}

export async function getGridHeaderBox(page: Page, colId: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const selector = `.ag-header-cell[col-id="${colId}"]`
  const element = page.locator(selector).first()
  await expect(element).toBeAttached({ timeout: 10000 })
  await expect(element).toBeVisible({ timeout: 10000 })

  const box = await element.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    const isHidden = style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0
    if (isHidden) return null
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })

  if (!box) {
    throw new Error(`Header cell for column col-id="${colId}" is not attached, hidden, or has zero width/height.`)
  }
  return box
}

export async function getGridCellBox(page: Page, colId: string, rowIndex = 0): Promise<{ x: number; y: number; width: number; height: number }> {
  const rowSelector = `.ag-row[row-index="${rowIndex}"]`
  const cellSelector = `${rowSelector} .ag-cell[col-id="${colId}"]`
  const cell = page.locator(cellSelector).first()
  await expect(cell).toBeAttached({ timeout: 10000 })
  await expect(cell).toBeVisible({ timeout: 10000 })

  const box = await cell.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    const isHidden = style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0
    if (isHidden) return null
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })

  if (!box) {
    throw new Error(`Body cell for column col-id="${colId}" at rowIndex=${rowIndex} is not attached, hidden, or has zero width/height.`)
  }
  return box
}

export async function expectColumnRenderedWidth(page: Page, colId: string, min: number, max: number) {
  const box = await getGridHeaderBox(page, colId)
  expect(box.width).toBeGreaterThanOrEqual(min)
  expect(box.width).toBeLessThanOrEqual(max)
}

export async function expectHeaderBodyAligned(page: Page, colId: string, tolerancePx = 2, maxRowsToCheck = 2) {
  const headerBox = await getGridHeaderBox(page, colId)
  
  // Check multiple rows when available
  for (let r = 0; r < maxRowsToCheck; r++) {
    const rowSelector = `.ag-row[row-index="${r}"]`
    const cellSelector = `${rowSelector} .ag-cell[col-id="${colId}"]`
    const cellLoc = page.locator(cellSelector).first()
    const exists = await cellLoc.count() > 0
    if (!exists) {
      if (r === 0) {
        throw new Error(`Body cell for column "${colId}" at row index 0 is not found or virtualized away unexpectedly.`)
      }
      break
    }
    
    const cellBox = await getGridCellBox(page, colId, r)
    const xDiff = Math.abs(headerBox.x - cellBox.x)
    const wDiff = Math.abs(headerBox.width - cellBox.width)

    if (xDiff > tolerancePx || wDiff > tolerancePx) {
      throw new Error(
        `Header/Body alignment mismatch for column "${colId}" at row index ${r}.\n` +
        `Header: x=${headerBox.x.toFixed(1)}, width=${headerBox.width.toFixed(1)}\n` +
        `Body Cell: x=${cellBox.x.toFixed(1)}, width=${cellBox.width.toFixed(1)}\n` +
        `Differences: x-diff=${xDiff.toFixed(1)}px, width-diff=${wDiff.toFixed(1)}px (tolerance=${tolerancePx}px)`
      )
    }
  }
}

export async function expectNoBrokenGridOverflow(page: Page, gridLocator: Locator) {
  await expect(gridLocator).toBeVisible()
  
  const result = await gridLocator.evaluate((gridEl) => {
    const rootWrapper = gridEl.closest('.ag-root-wrapper') || gridEl.querySelector('.ag-root-wrapper') || gridEl
    const centerViewport = rootWrapper.querySelector('.ag-center-cols-viewport')
    const bodyViewport = centerViewport || rootWrapper.querySelector('.ag-body-viewport') || gridEl.querySelector('.ag-body-viewport') || gridEl.closest('.ag-body-viewport')
    const headerViewport = rootWrapper.querySelector('.ag-header-viewport') || gridEl.querySelector('.ag-header-viewport') || gridEl.closest('.ag-header-viewport')
    
    if (!rootWrapper) return { ok: false, error: 'Could not find .ag-root-wrapper element' }
    if (!bodyViewport) return { ok: false, error: 'Could not find .ag-body-viewport element' }
    if (!headerViewport) return { ok: false, error: 'Could not find .ag-header-viewport element' }

    const wrapperRect = rootWrapper.getBoundingClientRect()
    const bodyRect = bodyViewport.getBoundingClientRect()
    const headerRect = headerViewport.getBoundingClientRect()

    if (wrapperRect.width === 0 || wrapperRect.height === 0) {
      return { ok: false, error: 'Grid root wrapper has zero width or height' }
    }
    if (bodyRect.width === 0 || bodyRect.height === 0) {
      return { ok: false, error: 'Grid body viewport has zero width or height' }
    }

    // Header and body viewports must be consistent in width
    const viewportWidthDiff = Math.abs(headerRect.width - bodyRect.width)
    if (viewportWidthDiff > 10) {
      return { ok: false, error: `Grid header viewport and body viewport widths are not consistent (diff: ${viewportWidthDiff}px, header: ${headerRect.width}px, body: ${bodyRect.width}px)` }
    }

    // Check clientWidth and scrollWidth of viewports
    if (centerViewport) {
      const scrollW = centerViewport.scrollWidth
      const clientW = centerViewport.clientWidth
      if (clientW === 0) {
        return { ok: false, error: 'Center viewport clientWidth is 0 (collapsed container)' }
      }
      
      const standardViewport = rootWrapper.querySelector('.ag-body-viewport')
      if (standardViewport) {
        const hasScrollbar = standardViewport.scrollWidth > standardViewport.clientWidth
        const outerScrollW = standardViewport.scrollWidth
        const outerClientW = standardViewport.clientWidth
        if (outerScrollW > outerClientW + 50 && !hasScrollbar) {
          return { ok: false, error: 'Grid has massive hidden horizontal overflow without scrollbar setup' }
        }
      }
    }

    // Check pinned vs center container overlap
    const pinnedLeft = rootWrapper.querySelector('.ag-pinned-left-cols-container') || rootWrapper.querySelector('.ag-pinned-left-header')
    const pinnedRight = rootWrapper.querySelector('.ag-pinned-right-cols-container') || rootWrapper.querySelector('.ag-pinned-right-header')

    if (pinnedLeft && centerViewport) {
      const leftRect = pinnedLeft.getBoundingClientRect()
      const centerRect = centerViewport.getBoundingClientRect()
      if (leftRect.width > 0 && centerRect.left < leftRect.right - 2) {
        return { ok: false, error: `Pinned left container overlaps center viewport (center left: ${centerRect.left}, pinned right: ${leftRect.right})` }
      }
    }

    if (pinnedRight && centerViewport) {
      const rightRect = pinnedRight.getBoundingClientRect()
      const centerRect = centerViewport.getBoundingClientRect()
      if (rightRect.width > 0 && centerRect.right > rightRect.left + 2) {
        return { ok: false, error: `Pinned right container overlaps center viewport (center right: ${centerRect.right}, pinned left: ${rightRect.left})` }
      }
    }

    // Check center cells are not rendered outside expected horizontal grid bounds under pinned panels
    if (centerViewport) {
      const centerRect = centerViewport.getBoundingClientRect()
      const centerCells = Array.from(centerViewport.querySelectorAll('.ag-cell'))
      const hasScrollbar = centerViewport.scrollWidth > centerViewport.clientWidth + 5
      for (const cell of centerCells) {
        const rect = cell.getBoundingClientRect()
        const style = window.getComputedStyle(cell)
        const isHidden = style.display === 'none' || style.visibility === 'hidden'
        if (!isHidden) {
          if (hasScrollbar) {
            // Horizontally offscreen cells are expected and naturally clipped when scroll is active
            continue;
          }
          if (rect.right < centerRect.left - 5 || rect.left > centerRect.right + 5) {
            return { ok: false, error: `Center cell for column "${cell.getAttribute('col-id')}" renders outside center viewport bounds` }
          }
        }
      }
    }

    // Check cells are not clipped to zero width or extremely narrow (< 10px) if they are supposed to be rendered
    const cells = Array.from(rootWrapper.querySelectorAll('.ag-cell'))
    for (const cell of cells) {
      const rect = cell.getBoundingClientRect()
      const style = window.getComputedStyle(cell)
      const isHidden = style.display === 'none' || style.visibility === 'hidden'
      if (!isHidden && rect.width < 10) {
        const colId = cell.getAttribute('col-id') || 'unknown'
        return { ok: false, error: `Rendered cell for column "${colId}" is unusably narrow (${rect.width}px)` }
      }
    }

    // Verify row actions column (if present) is reachable and has reasonable size
    const actionCell = rootWrapper.querySelector('.ag-cell[col-id="row_actions"]')
    if (actionCell) {
      const rect = actionCell.getBoundingClientRect()
      if (rect.width < 150) {
        return { ok: false, error: `Row actions column width (${rect.width}px) is narrow or crowded` }
      }
    }

    return { ok: true }
  })

  if (!result.ok) {
    throw new Error(`Broken Grid Layout/Overflow detected: ${result.error}`)
  }
}

export async function expectMenuAnchoredNearTrigger(
  page: Page,
  triggerLocator: Locator,
  menuLocator: Locator,
  options: {
    maxDistancePx?: number
    allowedSide?: 'left' | 'right' | 'top' | 'bottom' | 'any'
    viewportMarginPx?: number
  } = {}
) {
  const maxDistance = options.maxDistancePx ?? 400
  const allowedSide = options.allowedSide ?? 'any'
  const margin = options.viewportMarginPx ?? 10

  await expect(triggerLocator).toBeVisible()
  await expect(menuLocator).toBeVisible()

  const triggerBox = await triggerLocator.boundingBox()
  const menuBox = await menuLocator.boundingBox()

  if (!triggerBox || triggerBox.width === 0 || triggerBox.height === 0) {
    throw new Error('Trigger box is either null or has zero size')
  }
  if (!menuBox || menuBox.width === 0 || menuBox.height === 0) {
    throw new Error('Menu box is either null or has zero size')
  }

  // Get viewport dimensions
  const viewportSize = page.viewportSize()
  if (viewportSize) {
    // 1. Viewport containment checks
    if (
      menuBox.x < margin ||
      menuBox.y < margin ||
      menuBox.x + menuBox.width > viewportSize.width - margin ||
      menuBox.y + menuBox.height > viewportSize.height - margin
    ) {
      throw new Error(
        `Menu is not contained within the viewport boundaries (margin ${margin}px).\n` +
        `Viewport: ${viewportSize.width}x${viewportSize.height}\n` +
        `Menu: x=${menuBox.x}, y=${menuBox.y}, w=${menuBox.width}, h=${menuBox.height}`
      )
    }
  }

  // 2. Center-to-center distance check
  const tx = triggerBox.x + triggerBox.width / 2
  const ty = triggerBox.y + triggerBox.height / 2
  const mx = menuBox.x + menuBox.width / 2
  const my = menuBox.y + menuBox.height / 2
  const dist = Math.sqrt(Math.pow(tx - mx, 2) + Math.pow(ty - my, 2))

  if (dist > maxDistance) {
    throw new Error(`Menu is detached from trigger (distance ${dist.toFixed(1)}px exceeds limit of ${maxDistance}px)`)
  }

  // 3. Side constraints check
  if (allowedSide === 'bottom') {
    if (menuBox.y < triggerBox.y + triggerBox.height - 10) {
      throw new Error(`Menu expected to be below trigger, but menu y (${menuBox.y}) is above trigger bottom (${triggerBox.y + triggerBox.height})`)
    }
  } else if (allowedSide === 'top') {
    if (menuBox.y + menuBox.height > triggerBox.y + 10) {
      throw new Error(`Menu expected to be above trigger, but menu bottom (${menuBox.y + menuBox.height}) is below trigger top (${triggerBox.y})`)
    }
  } else if (allowedSide === 'right') {
    if (menuBox.x < triggerBox.x - 10) {
      throw new Error(`Menu expected to be aligned right of trigger, but menu x (${menuBox.x}) is left of trigger x (${triggerBox.x})`)
    }
  } else if (allowedSide === 'left') {
    if (menuBox.x + menuBox.width > triggerBox.x + triggerBox.width + 10) {
      throw new Error(`Menu expected to be aligned left of trigger, but menu right (${menuBox.x + menuBox.width}) is right of trigger right (${triggerBox.x + triggerBox.width})`)
    }
  }

  // 4. Verify menu does not overlap unrelated fixed utility grid controls (e.g. pinned-left column headers) unless triggered by them
  const isTriggerInPinnedLeft = await triggerLocator.evaluate((el) => {
    return !!el.closest('.ag-pinned-left-header') || !!el.closest('.ag-pinned-left-cols-container')
  }).catch(() => false)

  if (!isTriggerInPinnedLeft) {
    const pinnedLeftHeader = page.locator('.ag-pinned-left-header').first()
    if (await pinnedLeftHeader.isVisible().catch(() => false)) {
      const plBox = await pinnedLeftHeader.boundingBox()
      if (plBox && plBox.width > 0) {
        // Cap standard utility column width boundaries at 350px to allow pinned domain columns (like Src Node)
        const maxAllowedUtilityWidth = Math.min(plBox.width, 350)
        if (menuBox.x < plBox.x + maxAllowedUtilityWidth - 2) {
          throw new Error(`Unanchored menu overlaps the pinned left utility column headers! Menu x: ${menuBox.x}, Pinned right: ${plBox.x + maxAllowedUtilityWidth}`)
        }
      }
    }
  }
}

export function getWorkspaceRoot(page: Page, workspace: WorkspaceId): Locator {
  return page.locator(`[data-workspace="${workspace}"]:visible`).filter({ has: page.getByRole('heading') }).first()
}

export function getWorkspaceGrid(page: Page, workspace: WorkspaceId): Locator {
  return getWorkspaceRoot(page, workspace).getByRole('treegrid').first()
}

export function getWorkspaceRows(page: Page, workspace: WorkspaceId): Locator {
  return getWorkspaceGrid(page, workspace).locator('.ag-center-cols-container .ag-row')
}

export async function getWorkspaceLogicalRowByText(page: Page, workspace: WorkspaceId, text: string | RegExp): Promise<LogicalGridRow> {
  const root = getWorkspaceRoot(page, workspace)
  const escapedText = typeof text === 'string' ? text : text.source
  const matchedRow = root
    .locator('.ag-pinned-left-cols-container .ag-row, .ag-center-cols-container .ag-row')
    .filter({ hasText: text })
    .first()

  await expect(matchedRow, `Expected a visible ${workspace} grid row matching "${escapedText}"`).toBeVisible({ timeout: 15000 })

  const rowIdentity = await matchedRow.evaluate((node) => {
    const rowId = node.getAttribute('row-id')
    if (rowId) return { selector: 'row-id', value: rowId }
    const rowIndex = node.getAttribute('row-index')
    if (rowIndex) return { selector: 'row-index', value: rowIndex }
    return null
  })

  if (!rowIdentity) {
    throw new Error(`Matched ${workspace} grid row for "${escapedText}" is missing both row-id and row-index attributes.`)
  }

  const escapedValue = await page.evaluate((value) => CSS.escape(value), rowIdentity.value)
  const selector = `.ag-row[${rowIdentity.selector}=${escapedValue}]`
  const pinnedLocator = root.locator(`.ag-pinned-left-cols-container ${selector}`)
  const centerLocator = root.locator(`.ag-center-cols-container ${selector}`)
  const actionLocator = root.locator(`.ag-pinned-right-cols-container ${selector}`)
  const pinned = await pinnedLocator.count() > 0 ? pinnedLocator.first() : null
  const center = await centerLocator.count() > 0 ? centerLocator.first() : null
  const actions = await actionLocator.count() > 0 ? actionLocator.first() : null

  if (!pinned && !center) {
    throw new Error(`Resolved ${workspace} logical row "${escapedText}" (${rowIdentity.selector}=${rowIdentity.value}) but could not find pinned or center row fragments.`)
  }

  const action = (name: string | RegExp) => {
    const fragments = [pinned, center, actions].filter((fragment): fragment is Locator => fragment !== null)
    const candidates = fragments.map((fragment) => fragment.getByRole('button', { name }))
    const rowAction = candidates.slice(1).reduce((combined, candidate) => combined.or(candidate), candidates[0])
    return rowAction.describe(`${workspace} logical row ${rowIdentity.selector}=${rowIdentity.value} action ${String(name)}`)
  }

  const cell = async (columnId: string) => {
    const fragments = [pinned, center, actions].filter((fragment): fragment is Locator => fragment !== null)
    const candidates = fragments.map((fragment) => fragment.locator(`.ag-cell[col-id="${columnId}"]`))
    const counts = await Promise.all(candidates.map((candidate) => candidate.count()))
    const total = counts.reduce((sum, count) => sum + count, 0)
    if (total !== 1) {
      throw new Error(`Expected exactly one ${workspace} logical row ${rowIdentity.selector}=${rowIdentity.value} cell for col-id="${columnId}" across pinned, center, and action fragments; found ${total}.`)
    }
    return candidates[counts.findIndex((count) => count === 1)]
  }

  return {
    rowKey: rowIdentity.value,
    pinned,
    center,
    cell,
    action,
  }
}

function workspaceLogicalRowFragments(row: LogicalGridRow): Locator[] {
  return [row.pinned, row.center].filter((fragment): fragment is Locator => fragment !== null)
}

export async function expectWorkspaceLogicalRowSelected(row: LogicalGridRow) {
  const fragments = workspaceLogicalRowFragments(row)
  if (fragments.length === 0) {
    throw new Error(`Logical row ${row.rowKey} has no pinned or center fragments.`)
  }

  for (const fragment of fragments) {
    await expect(fragment).toHaveAttribute('aria-selected', 'true')
    await expect(fragment).toHaveClass(/ag-row-selected/)
  }
}

export async function selectWorkspaceLogicalRow(row: LogicalGridRow) {
  const fragments = workspaceLogicalRowFragments(row)
  const checkboxCandidates = fragments.map((fragment) =>
    fragment.getByRole('checkbox', { name: /Press Space to toggle row selection/ }),
  )
  const counts = await Promise.all(checkboxCandidates.map((checkbox) => checkbox.count()))
  const total = counts.reduce((sum, count) => sum + count, 0)

  if (total !== 1) {
    throw new Error(`Expected exactly one row-selection checkbox for logical row ${row.rowKey}; found ${total}.`)
  }

  const checkbox = checkboxCandidates[counts.findIndex((count) => count === 1)]
  await expect(checkbox).toBeVisible()
  await expect(checkbox).toBeEnabled()
  await expect(checkbox).not.toBeChecked()
  await checkbox.check()
  await expect(checkbox).toBeChecked()
  await expectWorkspaceLogicalRowSelected(row)
}

export function getWorkspaceRowByText(page: Page, workspace: WorkspaceId, text: string | RegExp): Locator {
  return getWorkspaceRoot(page, workspace)
    .locator('.ag-pinned-left-cols-container .ag-row, .ag-center-cols-container .ag-row')
    .filter({ hasText: text })
    .first()
}

export async function expectWorkspaceRoute(page: Page, path: string | RegExp) {
  await expect(page).toHaveURL(typeof path === 'string' ? new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?|$)`) : path)
}

export async function gotoView(page: Page, path: string, heading: string | RegExp, workspace?: WorkspaceId) {
  await page.goto(path)
  if (workspace) {
    await expectWorkspaceRoute(page, path.split('?')[0])
    await expect(getWorkspaceRoot(page, workspace)).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: heading })).toBeVisible()
}

export function getPrimaryGrid(page: Page, workspace?: WorkspaceId): Locator {
  return workspace ? getWorkspaceGrid(page, workspace) : page.locator('[role="treegrid"]').first()
}

export async function fillGridSearch(page: Page, placeholder: string | RegExp, value: string, workspace?: WorkspaceId) {
  const search = (workspace ? getWorkspaceRoot(page, workspace) : page).getByPlaceholder(placeholder)
  await search.fill(value)
  await page.keyboard.press('Enter')
  await expect(search).toHaveValue(value)
  return search
}

export async function selectGridCheckboxRows(page: Page, indices: number[]) {
  const checkboxes = page.locator('.ag-selection-checkbox')
  for (const index of indices) {
    await checkboxes.nth(index).click()
  }
}

export async function openToolbarButton(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name }).first().click()
}

export async function expectToast(page: Page, message: string | RegExp) {
  await expect(page.getByText(message).last()).toBeVisible()
}

export async function waitForAppIdle(page: Page) {
  const loaders = ['Scanning monitoring matrix...', 'Synchronizing Matrix...', 'Scanning infrastructure registry...', 'Synchronizing Intelligence Matrix...', 'Loading...']
  for (const loader of loaders) {
    await page.getByText(loader).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  }
}

type ResilientButtonSnapshot = {
  index: number
  connected: boolean
  enabled: boolean
  visible: boolean
  interactable: boolean
  dialogIndex: number
  dialogInteractable: boolean
  dialogZIndex: number
  dialogDomOrder: number
  interactionZIndex: number
  effectiveOpacity: number
  width: number
  height: number
}

type ResilientButtonScan = {
  name: string | RegExp
  candidates: Locator
  snapshots: ResilientButtonSnapshot[]
}

const RESILIENT_BUTTON_TOTAL_TIMEOUT_MS = 8_000
const RESILIENT_BUTTON_ATTEMPT_TIMEOUT_MS = 1_200
const RESILIENT_BUTTON_RESCAN_DELAY_MS = 75

function resilientButtonErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRetryableResilientButtonError(error: unknown) {
  const message = resilientButtonErrorMessage(error)
  if (/Target page, context or browser has been closed|Execution context was destroyed|Browser has been closed/i.test(message)) {
    return false
  }
  return /detached|not attached|timeout|not stable|not visible|not enabled|intercepts pointer events|outside of the viewport/i.test(message)
}

async function inspectResilientButtonCandidates(candidates: Locator): Promise<ResilientButtonSnapshot[]> {
  return candidates.evaluateAll((elements) => {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))

    const inspectElement = (element: HTMLElement) => {
      let effectiveOpacity = 1
      let hidden = false
      let interactionZIndex = 0
      let current: HTMLElement | null = element

      while (current) {
        const style = window.getComputedStyle(current)
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') hidden = true
        const opacity = Number.parseFloat(style.opacity)
        if (Number.isFinite(opacity)) effectiveOpacity *= opacity
        const zIndex = Number.parseInt(style.zIndex, 10)
        if (Number.isFinite(zIndex)) interactionZIndex = Math.max(interactionZIndex, zIndex)
        current = current.parentElement
      }

      const rect = element.getBoundingClientRect()
      return {
        effectiveOpacity,
        hidden,
        interactionZIndex,
        width: rect.width,
        height: rect.height,
      }
    }

    return elements.map((node, index) => {
      const element = node as HTMLElement
      const button = element as HTMLButtonElement
      const state = inspectElement(element)
      const dialog = element.closest<HTMLElement>('[role="dialog"]')
      const dialogIndex = dialog ? dialogs.indexOf(dialog) : -1
      let dialogZIndex = 0
      let dialogDomOrder = -1
      let dialogInteractable = true

      if (dialog) {
        const dialogState = inspectElement(dialog)
        const parsedZIndex = Number.parseInt(window.getComputedStyle(dialog).zIndex, 10)
        dialogZIndex = Number.isFinite(parsedZIndex) ? parsedZIndex : dialogState.interactionZIndex
        dialogDomOrder = dialogIndex
        dialogInteractable = (
          dialog.isConnected &&
          !dialogState.hidden &&
          dialogState.effectiveOpacity > 0.05 &&
          dialogState.width > 0 &&
          dialogState.height > 0
        )
      }

      const enabled = !button.disabled && element.getAttribute('aria-disabled') !== 'true'
      const connected = element.isConnected
      const visible = (
        connected &&
        !state.hidden &&
        state.width > 0 &&
        state.height > 0 &&
        dialogInteractable
      )
      // Candidate discovery deliberately does not reproduce browser hit-testing.
      // Playwright's bounded click is the source of truth for pointer interception,
      // stability, viewport reachability, and descendant pointer-event overrides.
      const interactable = visible && enabled

      return {
        index,
        connected,
        enabled,
        visible,
        interactable,
        dialogIndex,
        dialogInteractable,
        dialogZIndex,
        dialogDomOrder,
        interactionZIndex: state.interactionZIndex,
        effectiveOpacity: state.effectiveOpacity,
        width: state.width,
        height: state.height,
      }
    })
  })
}

function chooseTopResilientDialog(scans: ResilientButtonScan[]) {
  const dialogPresence = scans.flatMap((scan) => (
    scan.snapshots.filter((snapshot) => (
      snapshot.dialogIndex >= 0 && snapshot.dialogInteractable && snapshot.visible
    ))
  ))
  if (dialogPresence.length === 0) return -1

  return dialogPresence.reduce((current, candidate) => {
    if (candidate.dialogZIndex !== current.dialogZIndex) {
      return candidate.dialogZIndex > current.dialogZIndex ? candidate : current
    }
    return candidate.dialogDomOrder > current.dialogDomOrder ? candidate : current
  }).dialogIndex
}

function chooseResilientButtonCandidate(
  name: string | RegExp,
  snapshots: ResilientButtonSnapshot[],
  activeDialogIndex: number,
) {
  const scoped = activeDialogIndex >= 0
    ? snapshots.filter((snapshot) => snapshot.dialogIndex === activeDialogIndex)
    : snapshots.filter((snapshot) => snapshot.dialogIndex < 0)
  const eligible = scoped.filter((snapshot) => snapshot.interactable)
  const scope = activeDialogIndex >= 0 ? `dialog#${activeDialogIndex}` : 'page'

  if (eligible.length === 0) {
    return {
      selected: null,
      selectedScopeIndex: -1,
      activeDialogIndex,
      scope,
      eligibleCount: 0,
      scopedCount: scoped.length,
      totalCount: snapshots.length,
    }
  }

  const topLayerZIndex = Math.max(...eligible.map((snapshot) => snapshot.interactionZIndex))
  const active = eligible.filter((snapshot) => snapshot.interactionZIndex === topLayerZIndex)
  if (active.length > 1) {
    throw new Error(
      `Ambiguous button ${String(name)} in ${scope} at interaction layer ${topLayerZIndex}: ` +
      `found ${active.length} eligible matches`,
    )
  }

  const selected = active[0]
  return {
    selected,
    selectedScopeIndex: scoped.findIndex((snapshot) => snapshot.index === selected.index),
    activeDialogIndex,
    scope: `${scope}/z${topLayerZIndex}`,
    eligibleCount: eligible.length,
    scopedCount: scoped.length,
    totalCount: snapshots.length,
  }
}

export async function clickResilientButton(page: Page, ...names: (string | RegExp)[]) {
  if (names.length === 0) throw new Error('clickResilientButton requires at least one accessible button name')

  const startedAt = Date.now()
  const deadline = startedAt + RESILIENT_BUTTON_TOTAL_TIMEOUT_MS
  const diagnostics: string[] = []
  let attempt = 0

  while (Date.now() < deadline) {
    attempt += 1
    let attemptedClick = false
    const scans: ResilientButtonScan[] = []

    for (const name of names) {
      const candidates = page.getByRole('button', { name, exact: typeof name === 'string' })
      scans.push({ name, candidates, snapshots: await inspectResilientButtonCandidates(candidates) })
    }

    // Resolve modal scope before choosing a name. A disabled candidate in a newly
    // mounted top dialog blocks fallback to an older dialog or underlying page.
    const activeDialogIndex = chooseTopResilientDialog(scans)

    for (const scan of scans) {
      const choice = chooseResilientButtonCandidate(scan.name, scan.snapshots, activeDialogIndex)
      diagnostics.push(
        `attempt=${attempt} name=${String(scan.name)} total=${choice.totalCount} ` +
        `scoped=${choice.scopedCount} eligible=${choice.eligibleCount} scope=${choice.scope}`,
      )

      if (!choice.selected) continue

      attemptedClick = true
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      const attemptTimeout = Math.max(100, Math.min(RESILIENT_BUTTON_ATTEMPT_TIMEOUT_MS, remaining))

      try {
        // Recreate the live locator on every attempt. Native Playwright actionability
        // is intentionally authoritative for hit-testing and pointer interception.
        const liveScope = choice.activeDialogIndex >= 0
          ? page.getByRole('dialog').nth(choice.activeDialogIndex)
          : page
        await liveScope
          .getByRole('button', { name: scan.name, exact: typeof scan.name === 'string' })
          .nth(choice.selectedScopeIndex)
          .click({ timeout: attemptTimeout })
        return
      } catch (error) {
        const message = resilientButtonErrorMessage(error).replace(/\s+/g, ' ').slice(0, 320)
        diagnostics.push(`attempt=${attempt} click-error=${message}`)
        if (!isRetryableResilientButtonError(error)) {
          throw new Error(
            `Non-retryable click failure for ${String(scan.name)} after ${attempt} attempt(s): ${message}`,
            { cause: error instanceof Error ? error : undefined },
          )
        }
        break
      }
    }

    if (Date.now() >= deadline) break
    await page.waitForTimeout(attemptedClick ? RESILIENT_BUTTON_RESCAN_DELAY_MS : 100)
  }

  const elapsed = Date.now() - startedAt
  const recentDiagnostics = diagnostics.slice(-20).join(' | ')
  throw new Error(
    `Could not click one unique eligible button matching any of: ${names.map(String).join(', ')} ` +
    `within ${elapsed}ms. Diagnostics: ${recentDiagnostics || 'no candidates observed'}`,
  )
}

export async function verifyGridRowRobust(page: Page, searchString: string | RegExp) {
  await expect(page.locator('.ag-cell').filter({ hasText: searchString }).first()).toBeVisible({ timeout: 15000 })
}

export async function waitForColumnRendered(page: Page, colId: string, timeout = 10000) {
  const selector = `.ag-header-cell[col-id="${colId}"]`
  const loc = page.locator(selector).first()
  await loc.waitFor({ state: 'visible', timeout })
  
  await expect.poll(async () => {
    const box = await loc.boundingBox()
    return box && box.width > 0 && box.height > 0
  }, {
    message: `Waiting for column "${colId}" to render with a non-zero bounding box`,
    timeout,
  }).toBeTruthy()
}

export async function waitForColumnHidden(page: Page, colId: string, timeout = 10000) {
  const selector = `.ag-header-cell[col-id="${colId}"]`
  
  await expect.poll(async () => {
    const loc = page.locator(selector)
    const count = await loc.count()
    if (count === 0) return true
    for (let i = 0; i < count; i++) {
      const isVisible = await loc.nth(i).isVisible()
      if (isVisible) {
        const box = await loc.nth(i).boundingBox()
        if (box && box.width > 0) {
          return false
        }
      }
    }
    return true
  }, {
    message: `Waiting for column "${colId}" to be hidden`,
    timeout,
  }).toBeTruthy()
}
