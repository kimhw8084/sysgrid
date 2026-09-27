import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState, seedOperationalScenario } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
const evidenceDir = process.env.SYSGRID_CHG255_EVIDENCE_DIR
const isRootPreview = process.env.SYSGRID_VERIFY_PROFILE === 'root-preview'

type Proof = {
  semanticOwner?: string
  owner?: { exists: boolean; rect: Record<string, number> | null; text: string }
  actions?: Array<{ name: string; rect: Record<string, number> | null; visible: boolean; contrast: { color: string; background: string | null; ratio: number | null } | null }>
  actionClosure?: unknown
  [key: string]: unknown
}

type SettingsSurfaceClosure = {
  accepted: boolean
  activeTab: string | null
  viewport: { width: number; height: number }
  settingsOwner: Record<string, number> | null
  activeOwnerLayout: { rect: Record<string, number> | null; transform: string | null; opacity: string | null; scrollTop: number | null; scrollHeight: number | null; clientHeight: number | null }
  document: { bodyScrollWidth: number; documentScrollWidth: number; viewportWidth: number }
  wayfinding: { mode: 'wrap-all'; rect: Record<string, number> | null; tabs: Array<Record<string, unknown>>; exactlyOneActive: boolean }
  controls: Array<Record<string, unknown>>
  closureByScope?: Record<string, unknown>
  negativeControl: {
    kind: string
    name: string
    fullyInsideVisibleBounds: boolean
    readableNameContained: boolean
    reasons: string[]
    [key: string]: unknown
  } | null
}

async function renderedPageProof(page: import('@playwright/test').Page, semanticOwner: string, requiredActions: string[] = []): Promise<Proof> {
  return page.evaluate(({ semanticOwner: owner, actionNames }) => {
    const rect = (element: Element | null) => {
      if (!element) return null
      const value = element.getBoundingClientRect()
      return { x: value.x, y: value.y, width: value.width, height: value.height, left: value.left, right: value.right, top: value.top, bottom: value.bottom }
    }
    const colors = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/i)
      if (!match) return null
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1] as [number, number, number, number]
    }
    const composite = (front: [number, number, number, number], back: [number, number, number, number]) => {
      const alpha = front[3] + back[3] * (1 - front[3])
      if (alpha === 0) return [0, 0, 0, 0] as [number, number, number, number]
      return [0, 1, 2].map((index) => (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha).concat(alpha) as [number, number, number, number]
    }
    const luminance = ([red, green, blue]: [number, number, number, number]) => {
      const linear = (channel: number) => {
        const normalized = channel / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }
    const contrast = (element: Element | null) => {
      if (!element) return null
      const style = getComputedStyle(element)
      const foreground = colors(style.color)
      if (!foreground) return { color: style.color, background: null, ratio: null }
      let background: [number, number, number, number] = [0, 0, 0, 1]
      const chain: Element[] = []
      for (let node: Element | null = element; node; node = node.parentElement) chain.push(node)
      for (const node of chain.reverse()) {
        const color = colors(getComputedStyle(node).backgroundColor)
        if (color && color[3] > 0) background = composite(color, background)
      }
      const renderedForeground = [0, 1, 2].map((index) => foreground[index] * foreground[3] + background[index] * (1 - foreground[3])) as [number, number, number]
      const left = luminance([renderedForeground[0], renderedForeground[1], renderedForeground[2], 1])
      const right = luminance(background)
      return { color: style.color, background: `rgb(${background.slice(0, 3).map((part) => Math.round(part)).join(', ')})`, ratio: Number(((Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)).toFixed(2)) }
    }
    const ownerElement = document.querySelector(`[data-${owner}="true"]`)
      || document.querySelector(`[data-${owner}]`)
      || (owner === 'monitoring-workspace' ? document.querySelector('[data-workspace="monitoring"]') : null)
    const actions = actionNames.map((name) => {
      const candidates = [...document.querySelectorAll('button, input, a, [role="button"]')]
      const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
      const expected = normalize(name)
      const element = candidates.find((candidate) => {
        const node = candidate as HTMLInputElement
        return [node.getAttribute('aria-label'), node.getAttribute('title'), node.innerText, node.textContent, node.placeholder]
          .some((value) => value && normalize(value).includes(expected))
      }) || null
      const style = element ? getComputedStyle(element) : null
      return { name, rect: rect(element), visible: Boolean(element && element.getClientRects().length && style?.display !== 'none' && style?.visibility !== 'hidden' && Number(style?.opacity || 1) > 0), contrast: contrast(element) }
    })
    const segmented = [...document.querySelectorAll('[data-golden-segmented-scroll]')].map((element) => {
      const active = element.querySelector('[aria-pressed="true"]')
      return { rect: rect(element), scrollWidth: (element as HTMLElement).scrollWidth, clientWidth: (element as HTMLElement).clientWidth, scrollLeft: (element as HTMLElement).scrollLeft, activeLabel: active?.textContent?.trim() || null, activeRect: rect(active), activeContrast: contrast(active) }
    })
    return {
      semanticOwner: owner,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      document: { bodyScrollWidth: document.body.scrollWidth, documentScrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth, bodyScrollHeight: document.body.scrollHeight },
      owner: { exists: Boolean(ownerElement), rect: rect(ownerElement), text: ownerElement?.textContent?.trim().slice(0, 320) || '' },
      actions,
      segmented,
      visibleAlerts: [...document.querySelectorAll('[role="alert"]')].filter((element) => getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden').map((element) => element.textContent?.trim().slice(0, 160)),
      fatalState: Boolean(document.querySelector('[data-sg-state="fatal-error"]')),
    }
  }, { semanticOwner, actionNames: requiredActions })
}

async function assertNoBodyOverflow(page: import('@playwright/test').Page) {
  const geometry = await page.evaluate(() => ({ viewport: window.innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }))
  expect(noUncontrolledBodyOverflow(geometry), `uncontrolled document horizontal overflow: ${JSON.stringify(geometry)}`).toBe(true)
  return geometry
}

const noUncontrolledBodyOverflow = (geometry: { viewport: number; body: number; document: number }) =>
  geometry.document <= geometry.viewport + 1 && geometry.body <= geometry.viewport + 1

const hasExactlyOneCurrentOption = (pressedCount: number) => pressedCount === 1

async function assertReachable(locator: import('@playwright/test').Locator, name: string) {
  await expect(locator, `${name} must remain visible and enabled`).toBeVisible()
  await expect(locator, `${name} must remain enabled`).toBeEnabled()
  await locator.scrollIntoViewIfNeeded()
  const result = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    let clipped = false
    const clippingOwners: Array<Record<string, unknown>> = []
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (!/(hidden|clip|auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) {
        if (style.position === 'fixed') break
        continue
      }
      const parentRect = parent.getBoundingClientRect()
      const clippedX = style.overflowX !== 'visible' && (rect.left < parentRect.left - 1 || rect.right > parentRect.right + 1)
      const clippedY = style.overflowY !== 'visible' && (rect.top < parentRect.top - 1 || rect.bottom > parentRect.bottom + 1)
      if (clippedX || clippedY) {
        clipped = true
        clippingOwners.push({ tag: parent.tagName, className: typeof parent.className === 'string' ? parent.className : '', overflowX: style.overflowX, overflowY: style.overflowY, rect: { left: parentRect.left, right: parentRect.right, top: parentRect.top, bottom: parentRect.bottom }, clippedX, clippedY })
      }
      if (style.position === 'fixed') break
    }
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, clipped, clippingOwners, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }
  })
  expect(result.clipped, `${name} clipped by an overflow owner: ${JSON.stringify(result)}`).toBe(false)
  expect(result.right).toBeLessThanOrEqual(result.viewportWidth + 1)
  expect(result.left).toBeGreaterThanOrEqual(-1)
  expect(result.bottom).toBeLessThanOrEqual(result.viewportHeight + 1)
  expect(result.top).toBeGreaterThanOrEqual(-1)
}

async function captureProof(page: import('@playwright/test').Page, label: string, proof: Proof) {
  if (!evidenceDir) return
  mkdirSync(evidenceDir, { recursive: true })
  const safeLabel = label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
  await page.screenshot({ path: path.join(evidenceDir, `${safeLabel}.png`) })
  writeFileSync(path.join(evidenceDir, `${safeLabel}.json`), `${JSON.stringify(proof, null, 2)}\n`)
}

async function capture(page: import('@playwright/test').Page, label: string, owner: string, actions: string[] = []) {
  const proof = await renderedPageProof(page, owner, actions)
  await captureProof(page, label, proof)
  return proof
}

async function assertNoFatal(page: import('@playwright/test').Page, errors: string[]) {
  await expect(page.locator('[data-sg-state="fatal-error"]')).toHaveCount(0)
  expect(errors, `browser runtime errors: ${errors.join('\n')}`).toEqual([])
}

async function inspectSettingsSurfaceClosure(page: import('@playwright/test').Page, scope: 'all' | 'header' | 'wayfinding' | 'task' = 'all'): Promise<SettingsSurfaceClosure> {
  return page.evaluate((scope) => {
    type Bounds = { left: number; right: number; top: number; bottom: number; width: number; height: number }
    const toBounds = (element: Element | null): Bounds | null => {
      if (!element) return null
      const value = element.getBoundingClientRect()
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height }
    }
    const within = (inner: Bounds, outer: Bounds) =>
      inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1
    const workspace = document.querySelector('[data-settings-workspace="true"]')
    const workspaceBounds = toBounds(workspace)
    const settingsPanel = document.querySelector('[data-sg-content-panel="true"]')
    const settingsPanelBounds = toBounds(settingsPanel)
    const contentScroll = document.querySelector<HTMLElement>('[data-settings-content-scroll="true"]')
    const viewportBounds: Bounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight }
    const activeTab = document.querySelector('[data-settings-wayfinding] [data-settings-tab][aria-pressed="true"]')?.getAttribute('data-settings-tab') || null
    const activeOwner = activeTab ? document.querySelector(`[data-settings-tab-content="${activeTab}"]`) : null
    const visible = (element: Element) => {
      const style = getComputedStyle(element)
      const bounds = toBounds(element)
      return Boolean(bounds && bounds.width > 0 && bounds.height > 0 && element.getClientRects().length && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0)
    }
    const enabled = (element: Element) => {
      const control = element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      return !('disabled' in control && control.disabled) && element.getAttribute('aria-disabled') !== 'true'
    }
    const accessibleName = (element: Element) => {
      const control = element as HTMLInputElement
      return (element.getAttribute('aria-label') || element.getAttribute('title') || control.placeholder || element.textContent || '').trim().replace(/\s+/g, ' ')
    }
    const textBounds = (element: Element): Bounds[] => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const results: Bounds[] = []
      let node: Node | null
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const rect of [...range.getClientRects()]) {
          if (rect.width > 0 && rect.height > 0) results.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height })
        }
      }
      return results
    }
    const inspect = (element: Element, kind: string) => {
      const bounds = toBounds(element)
      const intendedOwner = kind === 'page-header-action'
        ? document.querySelector('[data-settings-header="true"]')
        : kind === 'wayfinding-tab'
          ? document.querySelector('[data-settings-wayfinding="true"]')
          : kind === 'active-tab-task-action'
            ? contentScroll
            : workspace
      const intendedOwnerBounds = toBounds(intendedOwner)
      const clip: Bounds = { ...viewportBounds }
      let clippedByAncestor = false
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor)
        const ancestorBounds = toBounds(ancestor)
        if (!ancestorBounds) continue
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) {
          clip.left = Math.max(clip.left, ancestorBounds.left)
          clip.right = Math.min(clip.right, ancestorBounds.right)
        }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) {
          clip.top = Math.max(clip.top, ancestorBounds.top)
          clip.bottom = Math.min(clip.bottom, ancestorBounds.bottom)
        }
      }
      clip.width = Math.max(0, clip.right - clip.left)
      clip.height = Math.max(0, clip.bottom - clip.top)
      const button = element as HTMLButtonElement
      const tag = element.tagName.toLowerCase()
      const semantic = ['button', 'input', 'select', 'textarea'].includes(tag) || (tag === 'a' && element.hasAttribute('href')) || Boolean(element.getAttribute('role'))
      const name = accessibleName(element)
      const textRects = textBounds(element)
      let readableNameContained = Boolean(bounds && textRects.length && textRects.every((rect) => within(rect, bounds) && within(rect, clip)))
      if (!textRects.length && element.getAttribute('aria-label')) {
        readableNameContained = Boolean(bounds && name && within(bounds, clip))
      }
      if (!textRects.length && name && 'placeholder' in element) {
        const input = element as HTMLInputElement
        const style = getComputedStyle(input)
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (context) {
          context.font = style.font
          const textWidth = context.measureText(input.placeholder).width
          readableNameContained = Boolean(bounds && textWidth <= input.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) + 1 && within(bounds, clip))
        }
      }
      const controlInOwner = Boolean(bounds && intendedOwnerBounds && within(bounds, intendedOwnerBounds))
      const controlInClip = Boolean(bounds && within(bounds, clip))
      const visibleNow = visible(element)
      const enabledNow = enabled(element)
      const tabIndex = (element as HTMLElement).tabIndex
      const keyboardReachable = semantic && enabledNow && tabIndex >= 0
      const style = getComputedStyle(element)
      const touchReachable = semantic && enabledNow && style.pointerEvents !== 'none' && style.touchAction !== 'none'
      const samples = bounds ? [
        [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
        [bounds.left + bounds.width * 0.25, bounds.top + bounds.height / 2],
        [bounds.left + bounds.width * 0.75, bounds.top + bounds.height / 2],
      ] : []
      const hitTargets = samples.map(([x, y]) => document.elementFromPoint(x, y))
      const pointerReachable = Boolean(bounds && hitTargets.length && hitTargets.every((target) => target === element || Boolean(target && element.contains(target))))
      const reasons = [
        ...(!semantic ? ['missing-semantic-control'] : []),
        ...(!enabledNow ? ['disabled'] : []),
        ...(!visibleNow ? ['not-visible'] : []),
        ...(!controlInOwner ? ['outside-settings-owner'] : []),
        ...(!controlInClip ? ['clipped-by-ancestor-or-viewport'] : []),
        ...(!readableNameContained ? ['label-not-fully-contained'] : []),
        ...(!pointerReachable ? ['pointer-intercepted-or-unreachable'] : []),
        ...(!keyboardReachable ? ['not-keyboard-reachable'] : []),
        ...(!touchReachable ? ['not-touch-reachable'] : []),
      ]
      return {
        kind,
        name,
        role: element.getAttribute('role') || tag,
        rect: bounds,
        visibleBounds: clip,
        semantic,
        enabled: enabledNow,
        visible: visibleNow,
        insideSettingsOwner: controlInOwner,
        fullyInsideVisibleBounds: controlInClip,
        readableNameContained,
        pointerReachable,
        keyboardReachable,
        touchReachable,
        tabIndex,
        reasons,
      }
    }

    const wayfinding = document.querySelector('[data-settings-wayfinding="true"]')
    const wayfindingBounds = toBounds(wayfinding)
    const tabElements = wayfinding ? [...wayfinding.querySelectorAll<HTMLButtonElement>('button[data-settings-tab]')] : []
    const tabs = tabElements.map((tab) => {
      const result = inspect(tab, 'wayfinding-tab')
      return { ...result, value: tab.dataset.settingsTab, active: tab.getAttribute('aria-pressed') === 'true', insideWayfinding: Boolean(result.rect && wayfindingBounds && within(result.rect as Bounds, wayfindingBounds)) }
    })
    const activeContentControls = activeOwner
      ? [...activeOwner.querySelectorAll('button, input, select, textarea, a[href], [role="button"]')].filter((element) => visible(element) && enabled(element))
      : []
    const taskControl = activeContentControls.find((element) => (element.tagName === 'BUTTON' || element.getAttribute('role') === 'button') && accessibleName(element)) || activeContentControls.find((element) => accessibleName(element)) || activeContentControls[0] || null
    const includeHeader = scope === 'all' || scope === 'header'
    const includeWayfinding = scope === 'all' || scope === 'wayfinding'
    const includeTask = scope === 'all' || scope === 'task'
    const controls = [
      ...(includeHeader ? [...(document.querySelector('[data-settings-header-actions="true"]')?.querySelectorAll('button') || [])].map((element) => inspect(element, 'page-header-action')) : []),
      ...(includeWayfinding ? tabElements.map((element) => inspect(element, 'wayfinding-tab')) : []),
      ...(includeTask && taskControl ? [inspect(taskControl, 'active-tab-task-action')] : []),
    ]
    const negativeElement = document.querySelector('[data-settings-oracle-negative-control="true"]')
    const negativeControl = negativeElement ? inspect(negativeElement, 'intentional-clipped-negative-control') : null
    const activeCount = tabs.filter((tab) => tab.active).length
    const activeOwnerStyle = activeOwner ? getComputedStyle(activeOwner) : null
    const documentGeometry = { bodyScrollWidth: document.body.scrollWidth, documentScrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }
    const accepted = Boolean(
      workspaceBounds &&
      wayfindingBounds &&
      (!includeWayfinding || (tabs.length > 0 && activeCount === 1 && tabs.every((tab) => tab.visible && tab.enabled && tab.semantic && tab.insideSettingsOwner && tab.fullyInsideVisibleBounds && tab.readableNameContained && tab.pointerReachable && tab.keyboardReachable && tab.touchReachable && tab.insideWayfinding))) &&
      controls.length === (includeWayfinding ? tabElements.length : 0) + (includeHeader ? (document.querySelector('[data-settings-header-actions="true"]')?.querySelectorAll('button').length || 0) : 0) + (includeTask && taskControl ? 1 : 0) &&
      controls.every((control) => control.visible && control.enabled && control.semantic && control.insideSettingsOwner && control.fullyInsideVisibleBounds && control.readableNameContained && control.pointerReachable && control.keyboardReachable && control.touchReachable) &&
      (!negativeControl || (negativeControl.fullyInsideVisibleBounds && negativeControl.readableNameContained && !negativeControl.reasons.includes('pointer-intercepted-or-unreachable'))) &&
      documentGeometry.bodyScrollWidth <= window.innerWidth + 1 &&
      documentGeometry.documentScrollWidth <= window.innerWidth + 1
    )
    return {
      accepted,
      activeTab,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      settingsOwner: settingsPanelBounds,
      activeOwnerLayout: {
        rect: toBounds(activeOwner),
        transform: activeOwnerStyle?.transform || null,
        opacity: activeOwnerStyle?.opacity || null,
        scrollTop: contentScroll?.scrollTop ?? null,
        scrollHeight: contentScroll?.scrollHeight ?? null,
        clientHeight: contentScroll?.clientHeight ?? null,
      },
      document: documentGeometry,
      wayfinding: { mode: 'wrap-all' as const, rect: wayfindingBounds, tabs, exactlyOneActive: activeCount === 1 },
      controls,
      negativeControl,
    }
  }, scope)
}

async function exposeFirstSettingsTaskAction(page: import('@playwright/test').Page) {
  const activeTab = page.locator('[data-settings-wayfinding] [data-settings-tab][aria-pressed="true"]')
  const value = await activeTab.getAttribute('data-settings-tab')
  expect(value).toBeTruthy()
  const owner = page.locator(`[data-settings-tab-content="${value}"]`)
  await expect(owner).toBeVisible()
  const buttons = owner.locator('button:visible:not(:disabled), [role="button"]:visible:not([aria-disabled="true"])')
  const candidates = await buttons.count() > 0
    ? buttons
    : owner.locator('input:visible:not(:disabled), select:visible:not(:disabled), textarea:visible:not(:disabled), a[href]:visible')
  if (await candidates.count() === 0) return null
  await expect(candidates.first()).toBeVisible()
  return candidates.first()
}

async function scrollSettingsContentByTouch(page: import('@playwright/test').Page, bounds: { x: number; y: number; width: number; height: number }, direction: number) {
  const session = await page.context().newCDPSession(page)
  const distance = Math.min(Math.max(Math.abs(direction), 20), Math.max(0, bounds.height - 8), 60)
  if (distance < 1) {
    await session.detach()
    return
  }
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const fromY = centerY + (direction > 0 ? distance / 2 : -distance / 2)
  const toY = centerY - (direction > 0 ? distance / 2 : -distance / 2)
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: centerX, y: fromY }] })
    const steps = 8
    for (let step = 1; step <= steps; step += 1) {
      await page.waitForTimeout(20)
      const y = fromY + ((toY - fromY) * step) / steps
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: centerX, y }] })
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await session.detach()
  }
}

async function scrollSettingsTargetIntoView(page: import('@playwright/test').Page, target: import('@playwright/test').Locator, ownerSelector: string) {
  const scrollOwner = page.locator(ownerSelector)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const ownerBounds = await scrollOwner.boundingBox()
    const targetBounds = await target.boundingBox()
    if (!ownerBounds || !targetBounds || ownerBounds.height <= 8) break
    const targetBottom = targetBounds.y + targetBounds.height
    const direction = targetBounds.y < ownerBounds.y
      ? -Math.ceil(ownerBounds.y - targetBounds.y + 12)
      : targetBottom > ownerBounds.y + ownerBounds.height
        ? Math.ceil(targetBottom - (ownerBounds.y + ownerBounds.height) + 12)
        : 0
    if (direction === 0) return
    const scrollTopBefore = await scrollOwner.evaluate((element) => (element as HTMLElement).scrollTop)
    await scrollSettingsContentByTouch(page, ownerBounds, direction)
    await page.waitForTimeout(80)
    const scrollTopAfter = await scrollOwner.evaluate((element) => (element as HTMLElement).scrollTop)
    const moved = direction < 0 ? scrollTopAfter < scrollTopBefore : scrollTopAfter > scrollTopBefore
    if (!moved) break
  }
  const ownerBounds = await scrollOwner.boundingBox()
  const targetBounds = await target.boundingBox()
  expect(ownerBounds && targetBounds && targetBounds.y >= ownerBounds.y - 1 && targetBounds.y + targetBounds.height <= ownerBounds.y + ownerBounds.height + 1,
    'Settings control did not reach its visible scroll owner: ' + JSON.stringify({
      ownerSelector,
      ownerBounds,
      targetBounds,
      scrollTop: await scrollOwner.evaluate((element) => (element as HTMLElement).scrollTop),
      scrollHeight: await scrollOwner.evaluate((element) => (element as HTMLElement).scrollHeight),
      clientHeight: await scrollOwner.evaluate((element) => (element as HTMLElement).clientHeight),
    })).toBe(true)
}

async function assertSettingsSurfaceClosure(page: import('@playwright/test').Page, options: { requireTaskAction?: boolean } = {}) {
  const task = await exposeFirstSettingsTaskAction(page)
  if (options.requireTaskAction) expect(task, `active Settings tab ${await page.locator('[data-settings-wayfinding] [aria-pressed="true"]').getAttribute('data-settings-tab')} has no enabled task action`).toBeTruthy()
  const header = page.locator('[data-settings-header-actions="true"]')
  const wayfinding = page.locator('[data-settings-wayfinding="true"]')
  const proofs: Record<string, SettingsSurfaceClosure> = {}
  if (await header.getByRole('button').count() > 0) {
    await scrollSettingsTargetIntoView(page, header, '[data-settings-workspace="true"]')
  }
  proofs.header = await inspectSettingsSurfaceClosure(page, 'header')
  expect(proofs.header.accepted, 'Settings header action closure failed: ' + JSON.stringify(proofs.header, null, 2)).toBe(true)
  await scrollSettingsTargetIntoView(page, wayfinding, '[data-settings-workspace="true"]')
  proofs.wayfinding = await inspectSettingsSurfaceClosure(page, 'wayfinding')
  expect(proofs.wayfinding.accepted, 'Settings wayfinding closure failed: ' + JSON.stringify(proofs.wayfinding, null, 2)).toBe(true)
  if (task) {
    const isMobile = await page.evaluate(() => window.innerWidth < 640)
    const taskOwner = isMobile ? '[data-settings-workspace="true"]' : '[data-settings-content-scroll="true"]'
    await scrollSettingsTargetIntoView(page, task, taskOwner)
  }
  proofs.task = await inspectSettingsSurfaceClosure(page, 'task')
  expect(proofs.task.accepted, 'Settings task action closure failed: ' + JSON.stringify(proofs.task, null, 2)).toBe(true)
  const profile = await page.evaluate(() => ({
    tab: document.querySelector('[data-settings-wayfinding] [aria-pressed="true"]')?.getAttribute('data-settings-tab') || 'unknown',
    width: window.innerWidth,
    height: window.innerHeight,
    textScale: document.documentElement.style.fontSize === '200%' ? 'text-200' : 'default-text',
  }))
  for (const scope of ['header', 'wayfinding', 'task'] as const) {
    await captureProof(page, `settings-${profile.tab}-closure-${scope}-${profile.width}x${profile.height}-${profile.textScale}`, {
      ...proofs[scope],
      closureScope: scope,
      textScale: profile.textScale,
      reachableBy: scope === 'wayfinding' ? ['touch', 'pointer', 'keyboard'] : ['touch-scroll', 'pointer-hit-test', 'keyboard-focus'],
    })
  }
  const proof: SettingsSurfaceClosure = {
    ...proofs.task,
    accepted: proofs.header.accepted && proofs.wayfinding.accepted && proofs.task.accepted,
    controls: [...proofs.header.controls, ...proofs.wayfinding.controls, ...proofs.task.controls],
    closureByScope: proofs,
    wayfinding: proofs.wayfinding.wayfinding,
  }
  const activeTab = proof.activeTab
  const expectedHeaderActions = activeTab === 'standards'
    ? []
    : activeTab === 'environments'
      ? ['Golden Template', 'Force Hot Reload']
      : ['Golden Template']
  await expect(header.getByRole('button')).toHaveCount(expectedHeaderActions.length)
  for (const name of expectedHeaderActions) {
    await expect(header.getByRole('button', { name, exact: true })).toBeEnabled()
  }
  return proof
}

const settingsCases = [
  { tab: 'environments', label: 'Parameters', content: 'Personal Preferences', proof: 'settings-parameters' },
  { tab: 'permissions', label: 'Permissions', content: 'Identity Sync Pipeline', proof: 'settings-permissions' },
  { tab: 'groups', label: 'Groups', content: 'No groups match the current search', proof: 'settings-groups' },
  { tab: 'system', label: 'Analysis', content: 'Runtime Analysis', proof: 'settings-analysis' },
  { tab: 'standards', label: 'Standards', content: 'Operational Standards Reference', proof: 'settings-standards' },
  { tab: 'metadata', label: 'Metadata', content: 'Metadata Registry', proof: 'settings-metadata' },
]

test('Settings mobile tab routes stay discoverable, operable, and content-bearing; Metadata desktop does not settle blank', async ({ page }) => {
  test.skip(isRootPreview, 'normal-v1 route proof; root-preview Architecture proof runs separately')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await resetBrowserState(page)
  await page.setViewportSize({ width: 390, height: 844 })

  for (const item of settingsCases) {
    await page.goto(`/settings?tab=${item.tab}`)
    const nav = page.locator('[data-settings-wayfinding="true"]')
    await expect(nav).toBeVisible()
    const tab = page.getByRole('button', { name: item.label, exact: true })
    await expect(tab).toHaveAttribute('aria-pressed', 'true')
    const contentOwner = page.locator(`[data-settings-tab-content="${item.tab}"]`)
    await expect(contentOwner).toBeVisible()
    await expect(contentOwner).toHaveCSS('opacity', '1')
    if (item.tab === 'groups') {
      await expect(page.getByPlaceholder('New group name...')).toBeVisible({ timeout: 15000 })
      await expect(page.getByText(item.content, { exact: true })).toBeVisible()
    } else {
      await expect(page.getByText(item.content, { exact: false }).first()).toBeVisible({ timeout: 15000 })
    }
    const tabGeometry = await tab.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const parent = element.closest('[data-settings-wayfinding]')!.getBoundingClientRect()
      return { left: rect.left, right: rect.right, parentLeft: parent.left, parentRight: parent.right, width: window.innerWidth }
    })
    expect(tabGeometry.left).toBeGreaterThanOrEqual(tabGeometry.parentLeft - 1)
    expect(tabGeometry.right).toBeLessThanOrEqual(tabGeometry.parentRight + 1)
    await assertNoBodyOverflow(page)
    const content = await capture(page, `${item.proof}-mobile-390x844`, 'settings-tab-content', [item.label])
    expect(content.owner.exists).toBe(true)
  }

  await page.goto('/settings?tab=groups')
  const newGroup = page.getByPlaceholder('New group name...')
  await newGroup.fill('Text retained across viewport change')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByRole('button', { name: 'Groups', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(newGroup).toHaveValue('Text retained across viewport change')
  await assertNoBodyOverflow(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings?tab=environments')
  const parameters = page.locator('[data-settings-tab-content="environments"]')
  await expect(page.locator('[data-settings-tab="metadata"]')).toBeVisible({ timeout: 15000 })
  await expect(parameters.getByText('Personal Preferences', { exact: true })).toBeVisible()
  const editButtons = parameters.locator('button[title="Edit Field"]')
  let parameterEditIndex = -1
  for (let index = 0; index < await editButtons.count(); index += 1) {
    const card = editButtons.nth(index).locator('xpath=../../..')
    if (await card.locator('input:not([type="checkbox"])').count() > 0) {
      parameterEditIndex = index
      break
    }
  }
  expect(parameterEditIndex).toBeGreaterThanOrEqual(0)
  const parameterEditControl = () => parameters.locator('button[title="Edit Field"], button[title="Lock & Discard Changes"]').nth(parameterEditIndex)
  const parameterInput = () => parameterEditControl().locator('xpath=../../..').locator('input:not([type="checkbox"])').first()
  await parameterInput().scrollIntoViewIfNeeded()
  await parameterEditControl().click()
  await parameterInput().fill('CHG-255-R3-unsaved-responsive-check')
  await expect(parameterInput()).toHaveValue('CHG-255-R3-unsaved-responsive-check')
  await expect(parameterEditControl().locator('xpath=../../..').getByText('Modified', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('[data-settings-tab="environments"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(parameterInput()).toHaveValue('CHG-255-R3-unsaved-responsive-check')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-settings-tab="environments"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(parameterInput()).toHaveValue('CHG-255-R3-unsaved-responsive-check')
  const parametersNav = page.locator('[data-settings-wayfinding="true"]')
  await parametersNav.getByRole('button', { name: 'Metadata', exact: true }).click()
  await expect(page.locator('[data-settings-tab="metadata"]')).toHaveAttribute('aria-pressed', 'true')
  await parametersNav.getByRole('button', { name: 'Parameters', exact: true }).click()
  await expect(page.locator('[data-settings-tab="environments"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(parameterInput()).toHaveValue('CHG-255-R3-unsaved-responsive-check')
  await expect(parameterEditControl().locator('xpath=../../..').getByText('Modified', { exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 600 })
  await page.goto('/settings?tab=metadata')
  const metadata = page.locator('[data-settings-tab-content="metadata"]')
  await expect(metadata).toBeVisible({ timeout: 15000 })
  await expect(metadata).toHaveCSS('opacity', '1')
  await expect(metadata.getByText('Monitoring Platforms', { exact: true })).toBeVisible()
  await assertNoBodyOverflow(page)
  await capture(page, 'settings-metadata-mobile-short-390x600', 'settings-tab-content', ['Metadata'])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings?tab=metadata')
  await page.evaluate(() => { document.documentElement.style.setProperty('font-size', '200%', 'important') })
  const pressuredMetadata = page.locator('[data-settings-tab-content="metadata"]')
  await expect(pressuredMetadata).toBeVisible()
  await expect(pressuredMetadata).toHaveCSS('opacity', '1')
  await assertNoBodyOverflow(page)
  await capture(page, 'settings-metadata-mobile-text-200', 'settings-tab-content', ['Metadata'])

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/settings?tab=metadata')
  const metadataDesktop = page.locator('[data-settings-tab-content="metadata"]')
  await expect(metadataDesktop).toBeVisible({ timeout: 15000 })
  await expect(metadataDesktop).toHaveCSS('opacity', '1')
  await expect(metadataDesktop.getByText('Monitoring Platforms', { exact: true })).toBeVisible()
  const desktopProof = await capture(page, 'settings-metadata-desktop-1440x900', 'settings-tab-content', ['Metadata'])
  expect(desktopProof.owner.rect).toBeTruthy()
  await assertNoBodyOverflow(page)
  await assertNoFatal(page, errors)
})

test.describe('Settings action closure and wrapped wayfinding', () => {
  test.use({ hasTouch: true })

  test('closes every authorized action at mobile, short, text-pressure, and desktop profiles', async ({ page }) => {
    test.skip(isRootPreview, 'normal-v1 Settings action-closure proof')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await resetBrowserState(page)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/settings?tab=environments')
    const nav = page.locator('[data-settings-wayfinding="true"]')
    await expect(nav).toBeVisible()
    const initial = await assertSettingsSurfaceClosure(page, { requireTaskAction: true })
    expect(initial.accepted, `390x844 initial Settings closure failed: ${JSON.stringify(initial, null, 2)}`).toBe(true)
    expect(initial.activeTab).toBe('environments')
    const firstTab = nav.locator('button[data-settings-tab]').first()
    await scrollSettingsTargetIntoView(page, firstTab, '[data-settings-workspace="true"]')
    await firstTab.tap()
    await expect(firstTab).toHaveAttribute('aria-pressed', 'true')

    const availableTabs = await nav.locator('button[data-settings-tab]').evaluateAll((buttons) => buttons.map((button) => ({
      value: (button as HTMLButtonElement).dataset.settingsTab || '',
      label: (button as HTMLButtonElement).innerText.trim().replace(/\s+/g, ' '),
    })))
    expect(availableTabs.length).toBeGreaterThan(0)
    const contentNames: Record<string, string> = {
      environments: 'Personal Preferences',
      permissions: 'Identity Sync Pipeline',
      groups: 'No groups match the current search',
      metadata: 'Metadata Registry',
      system: 'Runtime Analysis',
      diagnostics: 'Browser-runtime deployment diagnostics',
      tenants: 'Tenant Registry',
      standards: 'Operational Standards Reference',
    }

    for (const item of availableTabs) {
      const tab = nav.locator(`button[data-settings-tab="${item.value}"]`)
      await scrollSettingsTargetIntoView(page, nav, '[data-settings-workspace="true"]')
      const beforeActivation = await inspectSettingsSurfaceClosure(page, 'wayfinding')
      expect(beforeActivation.accepted, `Settings wayfinding not discoverable before ${item.value}: ${JSON.stringify(beforeActivation, null, 2)}`).toBe(true)
      await tab.tap()
      await tab.press('Enter')
      await expect(tab).toHaveAttribute('aria-pressed', 'true')
      const owner = page.locator(`[data-settings-tab-content="${item.value}"]`)
      await expect(owner).toBeVisible({ timeout: 15000 })
      await expect(owner).toHaveCSS('opacity', '1')
      if (item.value === 'groups') {
        await expect(page.getByPlaceholder('New group name...')).toBeVisible({ timeout: 15000 })
      }
      await expect(owner.getByText(contentNames[item.value], { exact: false }).first()).toBeVisible({ timeout: 15000 })
      const closure = await assertSettingsSurfaceClosure(page, { requireTaskAction: item.value !== 'system' })
      await assertNoBodyOverflow(page)
      const baseProof = await renderedPageProof(page, 'settings-tab-content', [item.label])
      await captureProof(page, `settings-${item.value}-mobile-390x844`, { ...baseProof, actionClosure: closure })
    }

    await page.setViewportSize({ width: 390, height: 600 })
    await page.goto('/settings?tab=environments')
    await expect(page.locator('[data-settings-tab="environments"]')).toHaveAttribute('aria-pressed', 'true')
    const shortClosure = await assertSettingsSurfaceClosure(page)
    await assertNoBodyOverflow(page)
    const shortProof = await renderedPageProof(page, 'settings-tab-content', ['Parameters', 'Golden Template', 'Force Hot Reload'])
    await captureProof(page, 'settings-parameters-mobile-short-390x600', { ...shortProof, actionClosure: shortClosure })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/settings?tab=environments')
    await expect(page.locator('[data-settings-tab="environments"]')).toHaveAttribute('aria-pressed', 'true')
    await page.evaluate(() => { document.documentElement.style.setProperty('font-size', '200%', 'important') })
    const pressureClosure = await assertSettingsSurfaceClosure(page)
    await assertNoBodyOverflow(page)
    const pressureProof = await renderedPageProof(page, 'settings-tab-content', ['Parameters', 'Golden Template', 'Force Hot Reload'])
    await captureProof(page, 'settings-parameters-mobile-text-200', { ...pressureProof, actionClosure: pressureClosure })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/settings?tab=metadata')
    await expect(page.locator('[data-settings-tab="metadata"]')).toHaveAttribute('aria-pressed', 'true')
    const desktopOwner = page.locator('[data-settings-tab-content="metadata"]')
    await expect(desktopOwner).toBeVisible({ timeout: 15000 })
    await expect(desktopOwner.getByText('Monitoring Platforms', { exact: true })).toBeVisible()
    const desktopClosure = await assertSettingsSurfaceClosure(page)
    await assertNoBodyOverflow(page)
    const desktopProof = await renderedPageProof(page, 'settings-tab-content', ['Metadata', 'Golden Template'])
    await captureProof(page, 'settings-metadata-desktop-1440x900', { ...desktopProof, actionClosure: desktopClosure })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => { document.documentElement.style.removeProperty('font-size') })
    await page.goto('/settings?tab=environments')
    const validClosure = await assertSettingsSurfaceClosure(page)
    await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>('[data-settings-workspace="true"]')!
      const clippedOwner = document.createElement('div')
      clippedOwner.style.cssText = 'position:absolute;left:12px;top:12px;width:48px;height:38px;overflow:hidden;z-index:99'
      const clippedAction = document.createElement('button')
      clippedAction.dataset.settingsOracleNegativeControl = 'true'
      clippedAction.type = 'button'
      clippedAction.style.cssText = 'display:block;width:140px!important;min-width:140px!important;max-width:none!important;height:36px;white-space:nowrap;flex:none'
      clippedAction.textContent = 'Force Hot Reload'
      clippedOwner.append(clippedAction)
      workspace.append(clippedOwner)
    })
    const withNegative = await inspectSettingsSurfaceClosure(page)
    const negative = withNegative.negativeControl
    expect(validClosure.accepted).toBe(true)
    expect(withNegative.accepted, `the isolated clipped fixture must fail the full Settings closure: ${JSON.stringify(withNegative, null, 2)}`).toBe(false)
    expect(negative?.name).toBe('Force Hot Reload')
    expect(negative?.fullyInsideVisibleBounds, JSON.stringify(negative, null, 2)).toBe(false)
    expect(negative?.readableNameContained, JSON.stringify(negative, null, 2)).toBe(false)
    expect(negative?.reasons).toContain('clipped-by-ancestor-or-viewport')
    expect(withNegative.document.bodyScrollWidth).toBeLessThanOrEqual(withNegative.document.viewportWidth + 1)
    expect(withNegative.document.documentScrollWidth).toBeLessThanOrEqual(withNegative.document.viewportWidth + 1)
    await page.locator('[data-settings-oracle-negative-control="true"]').evaluate((element) => element.parentElement?.remove())
    await captureProof(page, 'settings-action-closure-negative-control-mobile-390x844', {
      validAccepted: validClosure.accepted,
      negativeAccepted: withNegative.accepted,
      negativeControl: negative,
      negativeRejectedFor: 'clipped-by-ancestor-or-viewport and label-not-fully-contained',
      bodyOverflow: withNegative.document,
    })
    await assertNoFatal(page, errors)
  })
})

test('responsive geometry and current-state oracles accept controls and reject deliberate negative controls', async ({ page }) => {
  test.skip(isRootPreview, 'normal-v1 oracle control proof')
  await resetBrowserState(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings?tab=metadata')
  await expect(page.getByRole('button', { name: 'Metadata', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const geometry = await assertNoBodyOverflow(page)
  const pressedCount = await page.locator('[data-settings-wayfinding] [aria-pressed="true"]').count()
  expect(hasExactlyOneCurrentOption(pressedCount)).toBe(true)

  const geometryNegativeControl = { viewport: 390, body: 422, document: 422 }
  const stateNegativeControlPressedCount = 2
  expect(noUncontrolledBodyOverflow(geometryNegativeControl)).toBe(false)
  expect(hasExactlyOneCurrentOption(stateNegativeControlPressedCount)).toBe(false)
  await captureProof(page, 'responsive-oracle-controls-mobile-390x844', {
    legitimateControl: { route: '/settings?tab=metadata', geometry, pressedCount, accepted: noUncontrolledBodyOverflow(geometry) && hasExactlyOneCurrentOption(pressedCount) },
    negativeControls: [
      { kind: 'horizontal-overflow', geometry: geometryNegativeControl, rejected: !noUncontrolledBodyOverflow(geometryNegativeControl) },
      { kind: 'two-active-segment-options', pressedCount: stateNegativeControlPressedCount, rejected: !hasExactlyOneCurrentOption(stateNegativeControlPressedCount) },
    ],
  })
})

test('Audit Logs mobile task keeps data, pagination, and required row actions reachable with desktop holdout', async ({ page, sysApi: request }) => {
  test.skip(isRootPreview, 'normal-v1 route proof; root-preview Architecture proof runs separately')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await resetBrowserState(page)
  const { service } = await seedOperationalScenario(request)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/logs?target_table=logical_services&target_id=${service.id}`)
  await expect(page.locator('[data-audit-ledger="true"]')).toBeVisible()
  await expect(page.getByText(`Scoped: logical_services // ${service.id}`)).toBeVisible()
  const rows = page.locator('.ag-center-cols-container .ag-row')
  await expect(rows.first()).toBeVisible({ timeout: 20000 })
  const exportButton = page.getByRole('button', { name: 'Export loaded CSV' })
  await assertReachable(exportButton, 'Audit Logs export')
  const downloadPromise = page.waitForEvent('download')
  await exportButton.click()
  expect((await downloadPromise).suggestedFilename()).toMatch(/^SysGrid_AuditLoadedResult_/)
  const analytics = page.getByRole('button', { name: /Analytics/ })
  await assertReachable(analytics, 'Audit Logs Analytics')
  await analytics.click()
  await expect(page.getByText('Transaction Velocity (Loaded result/page)')).toBeVisible()
  const targetAction = page.getByRole('button', { name: 'Open target record' }).first()
  await assertReachable(targetAction, 'Audit Logs target navigation')
  const payloadAction = page.getByRole('button', { name: 'View change payload' }).first()
  await assertReachable(payloadAction, 'Audit Logs payload action')
  await payloadAction.click()
  await expect(page.getByRole('heading', { name: 'Audit Change Payload' })).toBeVisible()
  const pager = page.locator('.ag-paging-panel')
  await expect(pager).toBeVisible()
  const pagerBounds = await pager.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: window.innerWidth }
  })
  expect(pagerBounds.left).toBeGreaterThanOrEqual(-1)
  expect(pagerBounds.right).toBeLessThanOrEqual(pagerBounds.width + 1)
  await assertNoBodyOverflow(page)
  await page.getByRole('heading', { name: 'Audit Change Payload' }).locator('xpath=..').locator('xpath=..').getByRole('button').click()
  await expect(page.getByRole('heading', { name: 'Audit Change Payload' })).toHaveCount(0)
  await analytics.click()
  await expect(page.getByText('Transaction Velocity (Loaded result/page)')).toHaveCount(0)
  const compactPagerBounds = await pager.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: window.innerWidth }
  })
  expect(compactPagerBounds.left).toBeGreaterThanOrEqual(-1)
  expect(compactPagerBounds.right).toBeLessThanOrEqual(compactPagerBounds.width + 1)
  const auditProof = await renderedPageProof(page, 'audit-ledger', ['Export loaded CSV', 'View change payload'])
  await captureProof(page, 'audit-mobile-390x844', { ...auditProof, pagination: compactPagerBounds, dataRowCount: await rows.count(), targetActionVisible: await targetAction.isVisible(), payloadActionVisible: await payloadAction.isVisible() })

  await assertReachable(pager, 'Audit Logs pagination')
  await assertReachable(targetAction, 'Audit Logs target navigation after scrolling to pagination')
  await assertReachable(payloadAction, 'Audit Logs payload action after scrolling to pagination')
  const reachablePagerBounds = await pager.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const ownerRect = element.closest('[data-audit-ledger="true"]')!.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, ownerTop: ownerRect.top, ownerBottom: ownerRect.bottom, width: window.innerWidth }
  })
  expect(reachablePagerBounds.top).toBeGreaterThanOrEqual(reachablePagerBounds.ownerTop - 1)
  expect(reachablePagerBounds.bottom).toBeLessThanOrEqual(reachablePagerBounds.ownerBottom + 1)
  await assertNoBodyOverflow(page)
  const pagerProof = await renderedPageProof(page, 'audit-ledger', ['View change payload'])
  await captureProof(page, 'audit-mobile-pagination-390x844', { ...pagerProof, pagination: reachablePagerBounds, dataRowCount: await rows.count(), targetActionVisible: await targetAction.isVisible(), payloadActionVisible: await payloadAction.isVisible() })

  await page.setViewportSize({ width: 390, height: 600 })
  await expect(exportButton).toBeVisible()
  await assertReachable(exportButton, 'Audit Logs export at short height')
  await assertNoBodyOverflow(page)
  await capture(page, 'audit-mobile-short-390x600', 'audit-ledger', ['Export loaded CSV'])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { document.documentElement.style.setProperty('font-size', '200%', 'important') })
  await assertReachable(exportButton, 'Audit Logs export at 200% text pressure')
  await assertNoBodyOverflow(page)
  await capture(page, 'audit-mobile-text-200', 'audit-ledger', ['Export loaded CSV'])

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/logs?target_table=logical_services&target_id=${service.id}`)
  await expect(rows.first()).toBeVisible({ timeout: 20000 })
  await expect(page.getByRole('button', { name: 'Export loaded CSV' })).toBeVisible()
  await assertNoBodyOverflow(page)
  await capture(page, 'audit-desktop-1440x900', 'audit-ledger', ['Export loaded CSV'])
  await assertNoFatal(page, errors)
})

test('Knowledge mobile search and primary actions recompose under short-height and 200% text pressure; desktop holdout', async ({ page, sysApi: request }) => {
  test.skip(!isRootPreview, 'Knowledge preview route proof requires the explicitly configured System Root profile')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await resetBrowserState(page)
  const title = `PW-KNOWLEDGE-${Date.now()}-${'Long label content to stress responsive wrapping '.repeat(3)}`
  const created = await request.post(`${apiBase}/knowledge`, { data: { category: 'BKM', title, content: 'Candidate responsive search proof entry', status: 'Published', linked_device_ids: [], tags: ['golden-ui-v3'], metadata_json: { entry_type: 'Runbook', ownership: { owner: 'proof-operator' }, verification: { state: 'Needs Review' } }, content_json: { purpose: 'Validate Knowledge responsive task reachability', steps: [], rollback: '', validation: '' } } })
  expect(created.ok(), `Knowledge seed failed: ${created.status()} ${await created.text()}`).toBeTruthy()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/knowledge')
  const owner = page.locator('[data-knowledge-workspace="true"]')
  const search = page.getByRole('textbox', { name: 'Search Knowledge' })
  await expect(owner).toBeVisible()
  await search.fill('PW-KNOWLEDGE-')
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
  const action = page.getByRole('button', { name: /\+ New BKM/ })
  await assertReachable(search, 'Knowledge search')
  await assertReachable(action, 'Knowledge create BKM')
  const actionGeometry = await owner.locator('[data-knowledge-primary-actions] button').evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    const textRects = [...range.getClientRects()].map((rect) => ({ left: rect.left, right: rect.right }))
    return { label: element.textContent?.replace(/\s+/g, ' ').trim() || '', width: bounds.width, parentWidth: element.parentElement?.getBoundingClientRect().width || 0, scrollWidth: (element as HTMLElement).scrollWidth, clientWidth: (element as HTMLElement).clientWidth, textRects, textWithinButton: textRects.every((rect) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1) }
  }))
  expect(actionGeometry.length).toBeGreaterThanOrEqual(3)
  expect(actionGeometry.every((geometry) => geometry.width >= geometry.parentWidth - 1 && geometry.scrollWidth <= geometry.clientWidth + 4 && geometry.textWithinButton), JSON.stringify(actionGeometry)).toBe(true)
  expect(actionGeometry.map((geometry) => geometry.label).join(' ')).toContain('+ New BKM')
  await assertNoBodyOverflow(page)
  const knowledgeProof = await renderedPageProof(page, 'knowledge-workspace', ['Search Knowledge', '+ System Manual', '+ New BKM', '+ Ask Question'])
  const defaultActionContrast = knowledgeProof.actions?.filter((measurement) => measurement.name !== 'Search Knowledge') || []
  expect(defaultActionContrast.length).toBe(3)
  expect(defaultActionContrast.every((measurement) => (measurement.contrast?.ratio || 0) >= 4.5), JSON.stringify(defaultActionContrast)).toBe(true)
  const hoverActionContrast = [] as Array<{ name: string; color: string | null; background: string | null; ratio: number | null }>
  for (const name of ['+ System Manual', '+ New BKM', '+ Ask Question']) {
    await page.getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).hover()
    const hoverProof = await renderedPageProof(page, 'knowledge-workspace', [name])
    const measurement = hoverProof.actions?.[0]?.contrast
    expect((measurement?.ratio || 0) >= 4.5, `${name} hover contrast: ${JSON.stringify(measurement)}`).toBe(true)
    hoverActionContrast.push({ name, color: measurement?.color || null, background: measurement?.background || null, ratio: measurement?.ratio || null })
  }
  await page.mouse.move(0, 0)
  await captureProof(page, 'knowledge-mobile-390x844', { ...knowledgeProof, primaryActionGeometry: actionGeometry, hoverActionContrast })
  await action.click()
  await expect(page.getByRole('heading', { name: 'DRAFT BEST KNOWN METHOD' })).toBeVisible()
  await page.getByRole('button', { name: 'Discard Intelligence', exact: true }).click()

  await page.setViewportSize({ width: 390, height: 600 })
  await assertReachable(search, 'Knowledge search at short height')
  await assertReachable(action, 'Knowledge create BKM at short height')
  await assertNoBodyOverflow(page)
  await capture(page, 'knowledge-mobile-short-390x600', 'knowledge-workspace', ['Search Knowledge', '+ New BKM'])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { document.documentElement.style.setProperty('font-size', '200%', 'important') })
  await assertReachable(search, 'Knowledge search at 200% text pressure')
  await assertReachable(action, 'Knowledge create BKM at 200% text pressure')
  await assertNoBodyOverflow(page)
  await capture(page, 'knowledge-mobile-text-200', 'knowledge-workspace', ['Search Knowledge', '+ New BKM'])

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.reload()
  await expect(owner).toBeVisible()
  await assertReachable(search, 'Knowledge desktop search')
  await assertReachable(action, 'Knowledge desktop primary action')
  await assertNoBodyOverflow(page)
  await capture(page, 'knowledge-desktop-1440x900', 'knowledge-workspace', ['Search Knowledge', '+ New BKM'])
  await assertNoFatal(page, errors)
})

test('ToolbarSegmented non-Settings consumer and Monitoring holdout retain active state and task reachability', async ({ page, sysApi: request }) => {
  test.skip(isRootPreview, 'normal-v1 route proof; root-preview Architecture proof runs separately')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await resetBrowserState(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/v1/projects**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 3901, name: 'Segmented consumer regression', status: 'Active', priority: 'High', objective: 'Responsive shared toolbar regression', start_date: '2026-09-01', end_date: '2026-09-30', tasks: [], metadata_json: {} }]) })
      return
    }
    await route.continue()
  })
  await page.goto('/racks')
  const segmented = page.locator('[data-golden-segmented-scroll]').first()
  await expect(segmented).toBeVisible()
  const selectedRackView = segmented.locator('[aria-pressed="true"]')
  await expect(selectedRackView).toBeVisible()
  const selectedRackLabel = (await selectedRackView.innerText()).trim()
  await assertReachable(selectedRackView, 'Racks selected segmented view')
  await assertNoBodyOverflow(page)
  await capture(page, 'toolbar-segmented-racks-mobile-390x844', 'golden-segmented-scroll', [selectedRackLabel])
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(segmented).toBeVisible()
  await assertNoBodyOverflow(page)
  await capture(page, 'toolbar-segmented-racks-desktop-1440x900', 'golden-segmented-scroll', [selectedRackLabel])
  await page.setViewportSize({ width: 390, height: 600 })
  await expect(segmented.locator('[aria-pressed="true"]')).toBeVisible()
  await assertReachable(segmented.locator('[aria-pressed="true"]'), 'Racks selected segmented view at short height')
  await assertNoBodyOverflow(page)
  await capture(page, 'toolbar-segmented-racks-mobile-short-390x600', 'golden-segmented-scroll', [selectedRackLabel])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { document.documentElement.style.setProperty('font-size', '200%', 'important') })
  await assertReachable(segmented.locator('[aria-pressed="true"]'), 'Racks selected segmented view at 200% text pressure')
  await assertNoBodyOverflow(page)
  await capture(page, 'toolbar-segmented-racks-mobile-text-200', 'golden-segmented-scroll', [selectedRackLabel])

  await resetBrowserState(page)
  const { primary } = await seedOperationalScenario(request)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/monitoring')
  await expect(page.locator('[data-workspace="monitoring"], [data-monitoring-workspace="true"]').first()).toBeVisible()
  const monitoringSwitch = page.locator('[data-golden-segmented-scroll]').first()
  await expect(monitoringSwitch).toBeVisible()
  const selected = monitoringSwitch.locator('[aria-pressed="true"]')
  await expect(selected).toBeVisible()
  const selectedLabel = (await selected.innerText()).trim()
  await assertReachable(selected, 'Monitoring selected scope')
  await assertNoBodyOverflow(page)
  const mobileMonitoringProof = await capture(page, 'monitoring-holdout-mobile-390x844', 'monitoring-workspace', [selectedLabel])
  expect(mobileMonitoringProof.owner?.exists).toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(monitoringSwitch).toBeVisible()
  await assertNoBodyOverflow(page)
  const desktopMonitoringProof = await capture(page, 'monitoring-holdout-desktop-1440x900', 'monitoring-workspace', [selectedLabel])
  expect(desktopMonitoringProof.owner?.exists).toBe(true)
  expect(primary.id).toBeGreaterThan(0)
  await assertNoFatal(page, errors)
})

test('Architecture v2 and legacy primary tasks remain reachable at mobile, short-height, 200%, and desktop', async ({ page, sysApi: request }) => {
  test.skip(!isRootPreview, 'Architecture preview proof requires the explicitly configured System Root profile')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const policyResponse = await request.get(`${apiBase}/policy/module-availability`)
  expect(policyResponse.ok()).toBeTruthy()
  const policy = await policyResponse.json()
  expect(policy.identity?.system_root).toBe(true)
  await resetBrowserState(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/architecture')
  const createForm = page.locator('[data-architecture-create-model="true"]')
  await expect(createForm).toBeVisible({ timeout: 20000 })
  const input = page.getByRole('textbox', { name: 'New Architecture model name' })
  const create = page.getByRole('button', { name: 'Create model', exact: true })
  const longModelName = `Responsive Architecture Model ${'Long text pressure '.repeat(5)}`
  await input.fill(longModelName)
  await input.evaluate((element: HTMLInputElement) => element.blur())
  await assertReachable(input, 'Architecture v2 model name')
  await assertReachable(create, 'Architecture v2 create model')
  await assertNoBodyOverflow(page)
  await capture(page, 'architecture-v2-mobile-390x844', 'architecture-create-model', ['New Architecture model name', 'Create model'])

  await page.setViewportSize({ width: 390, height: 600 })
  await expect(input).toHaveValue(longModelName)
  await assertReachable(create, 'Architecture v2 create model at short height')
  await assertNoBodyOverflow(page)
  await capture(page, 'architecture-v2-mobile-short-390x600', 'architecture-create-model', ['Create model'])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { document.documentElement.style.setProperty('font-size', '200%', 'important') })
  await assertReachable(create, 'Architecture v2 create model at 200% text pressure')
  await assertNoBodyOverflow(page)
  await capture(page, 'architecture-v2-mobile-text-200', 'architecture-create-model', ['Create model'])
  await create.click()
  await expect(page.getByRole('heading', { name: longModelName, exact: true })).toBeVisible({ timeout: 20000 })
  await expect(page.locator('[role="alert"]')).toHaveCount(0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/architecture')
  await expect(page.locator('[data-pv1-architecture-host="true"]')).toBeVisible({ timeout: 20000 })
  await assertNoBodyOverflow(page)
  await capture(page, 'architecture-v2-desktop-1440x900', 'pv1-architecture-host', ['Proposed object name', 'Create Draft proposal'])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/architecture?legacy=true')
  const legacy = page.locator('[data-architecture-legacy="true"]')
  const legacyAction = page.locator('[data-architecture-legacy-create="true"]')
  await expect(legacy).toBeVisible({ timeout: 20000 })
  await expect(page.getByRole('heading', { name: 'Architecture Matrix' })).toBeVisible()
  await assertReachable(legacyAction, 'Legacy Architecture create action')
  const matrix = page.locator('[data-architecture-legacy-matrix="true"]')
  await expect(matrix).toBeVisible()
  await assertNoBodyOverflow(page)
  await capture(page, 'architecture-legacy-mobile-390x844', 'architecture-legacy', ['New Architecture'])
  await matrix.scrollIntoViewIfNeeded()
  const gridViewport = matrix.locator('.ag-body-viewport')
  await expect(gridViewport).toBeVisible()
  const gridGeometry = await gridViewport.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }))
  expect(gridGeometry.clientWidth).toBeGreaterThan(0)
  await captureProof(page, 'architecture-legacy-mobile-matrix-390x844', { ...(await renderedPageProof(page, 'architecture-legacy')), gridScrollOwner: gridGeometry })

  await page.setViewportSize({ width: 390, height: 600 })
  await assertReachable(legacyAction, 'Legacy Architecture create action at short height')
  await assertNoBodyOverflow(page)
  await capture(page, 'architecture-legacy-mobile-short-390x600', 'architecture-legacy', ['New Architecture'])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { document.documentElement.style.setProperty('font-size', '200%', 'important') })
  await assertReachable(legacyAction, 'Legacy Architecture create action at 200% text pressure')
  await legacyAction.click()
  const modal = page.locator('.glass-panel').filter({ has: page.getByRole('heading', { name: 'New Architecture' }) })
  await expect(modal).toBeVisible()
  await modal.getByPlaceholder(/core payment ingress/i).fill(`R2 Legacy Matrix ${'Long label '.repeat(4)}`)
  await modal.getByPlaceholder('Describe the business and technical purpose...').fill('Responsive legacy form action reachability proof')
  await modal.getByPlaceholder('e.g. Core Platform').fill('Core Platform')
  await modal.getByPlaceholder('Critical / High / Medium / Low').fill('Critical')
  await modal.getByPlaceholder('Tier 1 / Tier 2 / Tier 3').fill('Tier 1')
  await modal.getByPlaceholder('Approved / Needs Review / Exception').fill('Approved')
  await modal.getByPlaceholder('https://wiki.example.com/runbook').fill('https://wiki.example.com/architecture-runbook')
  const submit = modal.getByRole('button', { name: /Create Architecture/i })
  await assertReachable(submit, 'Legacy Architecture modal create action at 200% text pressure')
  await assertNoBodyOverflow(page)
  await capture(page, 'architecture-legacy-mobile-text-200', 'architecture-legacy', ['New Architecture'])
  await submit.click()
  await expect(modal).toHaveCount(0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/architecture?legacy=true')
  await expect(page.locator('[data-architecture-legacy="true"]')).toBeVisible({ timeout: 20000 })
  await assertReachable(page.locator('[data-architecture-legacy-create="true"]'), 'Legacy Architecture desktop create action')
  await assertNoBodyOverflow(page)
  await capture(page, 'architecture-legacy-desktop-1440x900', 'architecture-legacy', ['New Architecture'])
  await assertNoFatal(page, errors)
})
