import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'

test('storage reset stays inert and real application startup remains observed', async ({ page }) => {
  const errors: string[] = []
  let scripts = 0
  let bootstraps = 0
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (request.resourceType() === 'script') scripts++
    if (new URL(request.url()).pathname === '/api/v1/settings/bootstrap') bootstraps++
  })
  await resetBrowserState(page)
  expect(scripts, 'Storage cleanup must not execute an app that will immediately be torn down').toBe(0)
  expect(bootstraps, 'Storage cleanup must not start background bootstrap requests').toBe(0)
  await page.goto('/asset')
  await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible()
  expect(scripts).toBeGreaterThan(0)
  expect(bootstraps).toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('reset removes stale owned storage despite helper-navigation failure and preserves later work', async ({ page }) => {
  await resetBrowserState(page)
  await page.goto('/asset')
  await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible()
  await page.evaluate(() => {
    localStorage.setItem('sysgrid_reset_probe', 'stale')
    sessionStorage.setItem('SYSGRID_RESET_PROBE', 'stale')
    localStorage.setItem('other-app-preference', 'preserve')
    sessionStorage.setItem('other-app-preference', 'preserve')
  })
  const realGoto = page.goto.bind(page)
  page.goto = async (url, options) => {
    if (url === '/') throw new Error('Injected helper-document navigation failure')
    return realGoto(url, options)
  }
  await resetBrowserState(page)
  await page.goto('/asset')
  await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible()
  const state = () => page.evaluate(() => ({
    localOwned: localStorage.getItem('sysgrid_reset_probe'), sessionOwned: sessionStorage.getItem('SYSGRID_RESET_PROBE'),
    localOther: localStorage.getItem('other-app-preference'), sessionOther: sessionStorage.getItem('other-app-preference'),
  }))
  expect(await state()).toEqual({ localOwned: null, sessionOwned: null, localOther: 'preserve', sessionOther: 'preserve' })
  await page.evaluate(() => {
    localStorage.setItem('sysgrid_reset_probe', 'current-work')
    sessionStorage.setItem('SYSGRID_RESET_PROBE', 'current-work')
  })
  await page.goto('/services')
  await expect(page.getByRole('heading', { name: 'Services', exact: true })).toBeVisible()
  expect(await state()).toEqual({ localOwned: 'current-work', sessionOwned: 'current-work', localOther: 'preserve', sessionOther: 'preserve' })
})
