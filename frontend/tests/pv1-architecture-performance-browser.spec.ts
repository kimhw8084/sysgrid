import { expect, request, test, type Page } from '@playwright/test'

const apiOrigin = () => process.env.SYSGRID_P07_API_ORIGIN || ''
const user = 'p07.architecture'

async function setupLargeModel() {
  const api = await request.newContext({ baseURL: apiOrigin(), extraHTTPHeaders: { 'X-User-Id': user, 'X-Tenant-Id': '1' } })
  const modelId = process.env.SYSGRID_P07_LARGE_MODEL_ID
  if (!modelId) throw new Error('SYSGRID_P07_LARGE_MODEL_ID is required for the real large Architecture fixture')
  const response = await api.get(`/api/v2/architecture/models/${modelId}`, { headers: { 'X-User-Id': user, 'X-Tenant-Id': '1' } })
  expect(response.ok(), await response.text()).toBeTruthy()
  const projection = await response.json()
  expect(projection.objects).toHaveLength(5000)
  expect(projection.relations).toHaveLength(10000)
  return { api, modelId, projection }
}

async function open(page: Page, modelId: string) {
  await page.addInitScript(({ origin, user: identity }) => {
    localStorage.setItem('SYSGRID_OVERRIDE_API_URL', origin)
    localStorage.setItem('SYSGRID_USER_ID', identity)
    localStorage.setItem('SYSGRID_TENANT_ID', '1')
  }, { origin: apiOrigin(), user })
  await page.goto(`/architecture?model=${modelId}&mode=current`)
}

test.beforeEach(() => test.skip(!process.env.P07_REAL_BACKEND, 'requires isolated P07 backend proof runtime'))

test('Large Architecture culling preserves full search/list access and bounded rendering', async ({ page }) => {
  const fixture = await setupLargeModel()
  try {
    await open(page, fixture.modelId)
    await expect(page.getByRole('button', { name: /^P07 Large Architecture Object 00000, Application\/Service, revision \d+$/ })).toBeVisible()
    await expect(page.getByText(/5000 objects/)).toBeVisible()
    await expect(page.getByText(/10000 relations/)).toBeVisible()
    const realizedObjects = await page.locator('[role="img"][aria-label="Architecture diagram projection"] svg g[role="button"]').count()
    expect(realizedObjects).toBeLessThanOrEqual(200)

    const search = page.getByLabel('Search Architecture objects')
    const samples: number[] = []
    const sampleCount = 100
    for (let index = 0; index < sampleCount; index += 1) {
      const target = `P07 Large Architecture Object ${String(4000 + (index % 100)).padStart(5, '0')}`
      const started = await page.evaluate(() => performance.now())
      await search.fill(target)
      await expect(page.locator('button[role="listitem"]', { hasText: target })).toBeVisible()
      samples.push((await page.evaluate(() => performance.now())) - started)
    }
    await search.fill('P07 Large Architecture Object 04500')
    const target = page.locator('button[role="listitem"]', { hasText: 'P07 Large Architecture Object 04500' })
    await target.focus()
    await target.press('Enter')
    await expect(target).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('.sg-sr')).toContainText('5000 authorized objects')
    await search.fill('')
    await expect(page.locator('button[role="listitem"]', { hasText: 'P07 Large Architecture Object 00000' })).toBeVisible({ timeout: 30_000 })
    expect(samples).toHaveLength(sampleCount)
    const ordered = [...samples].sort((left, right) => left - right)
    const p95 = ordered[Math.floor((ordered.length - 1) * 0.95)]
    const p50 = ordered[Math.floor((ordered.length - 1) * 0.50)]
    const max = ordered[ordered.length - 1]
    console.log(JSON.stringify({ schema: 'sysgrid.pv1.architecture-browser-performance.v2', profile: 'Architecture', object_count: 5000, relation_count: 10000, sample_count: samples.length, p50_ms: p50, p95_ms: p95, max_ms: max, realized_objects: realizedObjects, searchable_objects: 5000, searchable_relations: 10000, offscreen_target: 'p07-large-object-04500', verdict: p95 <= 2000 }))
    expect(p95).toBeLessThanOrEqual(2000)
  } finally {
    await fixture.api.dispose()
  }
})
