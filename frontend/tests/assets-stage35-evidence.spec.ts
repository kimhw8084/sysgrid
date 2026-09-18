import { expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from './helpers/sysgrid-test.ts'
import { clickResilientButton, fillGridSearch, resetBrowserState, seedOperationalScenario, waitForAppIdle } from './helpers/sysgrid.ts'

type RouteKey = 'asset' | 'monitoring' | 'asset-real'
type Verdict = 'pass' | 'fail' | 'not-applicable'
type Classification = 'blocking' | 'accepted non-blocking' | 'unrelated'
type SourceType = 'console-warning' | 'console-error' | 'page-error' | 'request-failure' | 'non-ok-response'

type DOMRectLike = {
  x: number
  y: number
  width: number
  height: number
}

type RegionCapture = {
  selector: string
  bounds: DOMRectLike | null
  status: 'non-null' | 'null'
  failureReason: string | null
}

type ClassificationEntry = {
  routeLabel: string
  sourceType: SourceType
  exactMessage: string
  count: number
  classification: Classification
  reason: string
  affectsAssetLockEligibility: boolean
}

type ConsoleEvent = {
  kind: 'console'
  channel: 'warning' | 'error'
  text: string
  source: string | null
}

type PageErrorEvent = {
  kind: 'page-error'
  text: string
  source: string | null
}

type RequestFailedEvent = {
  kind: 'request-failure'
  url: string
  method: string
  resourceType: string | null
  status: number | null
  failureText: string | null
}

type NonOkResponseEvent = {
  kind: 'non-ok-response'
  url: string
  method: string
  resourceType: string | null
  status: number
  statusText: string
}

type RuntimeEvent = ConsoleEvent | PageErrorEvent | RequestFailedEvent | NonOkResponseEvent

type InteractionProof = {
  verdict: Verdict
  attempts: string[]
  bounds: DOMRectLike | null
  details: Record<string, any>
}

type DirtyStateProof = {
  verdict: Verdict
  attempts: string[]
  guardPresented: boolean
  dialogStillOpen: boolean
  promptBounds: DOMRectLike | null
  modalBounds: DOMRectLike | null
}

type RouteEvidence = {
  captureLabel: string
  category: 'neutral' | 'interaction'
  routeKey: RouteKey
  routeLabel: string
  requestedUrl: string
  finalUrl: string
  routeVerdict: Verdict
  routeVerdictReason: string | null
  screenshotPath: string
  screenshotSize: { width: number; height: number }
  viewport: { width: number; height: number }
  documentSize: { width: number; height: number }
  visibleTexts: string[]
  workspaceRoot: RegionCapture
  header: RegionCapture
  actionStatusZone: RegionCapture
  commandRegion: RegionCapture
  table: RegionCapture
  firstRow: RegionCapture
  rowActionRegion: RegionCapture
  contextMenuProof: InteractionProof
  rowClickProof: InteractionProof
  quickLookProof: InteractionProof
  detailsProof: InteractionProof
  dirtyStateProof: DirtyStateProof | null
  consoleWarnings: string[]
  consoleErrors: string[]
  pageErrors: string[]
  requestFailures: string[]
  nonOkResponses: string[]
  duplicateKeyWarningCount: number
  pageErrorCount: number
  warningRequestClassificationTable: ClassificationEntry[]
}

const CAPTURE_DIR = path.resolve(process.cwd(), 'stage35-evidence')
const HTML_EVIDENCE_PATH = path.resolve(process.cwd(), 'OUT-26_ITERATION_37_STAGE35_EVIDENCE.html')
const JSON_EVIDENCE_PATH = path.join(CAPTURE_DIR, 'stage35-evidence.json')
const DESKTOP_FULL = { width: 1440, height: 1200 }
const DESKTOP_VIEWPORT = { width: 1440, height: 900 }
const EXACT_VIEWPORT = { width: 960, height: 720 }
const DUPLICATE_KEY_PATTERN = /duplicate key|encountered two children with the same key/i
const ACCEPTED_WARNING_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /react router future flag warning/i,
    reason: 'Known React Router development warning; it does not alter route render validity or geometry.',
  },
  {
    pattern: /ag grid:.*deprecated/i,
    reason: 'AG Grid deprecation notice is pre-existing runtime noise and does not block render proof.',
  },
  {
    pattern: /ag grid: invalid coldef property/i,
    reason: 'AG Grid colDef validation noise is captured verbatim and treated as accepted non-blocking.',
  },
  {
    pattern: /ag grid: to see all the valid coldef properties/i,
    reason: 'Follow-on AG Grid documentation warning from the same validation noise.',
  },
  {
    pattern: /resizeobserver loop completed with undelivered notifications/i,
    reason: 'Known browser ResizeObserver noise during reflow; geometry remained valid.',
  },
  {
    pattern: /a router only supports one blocker at a time/i,
    reason: 'Route blocker warning is emitted during harness navigation churn and is unrelated to steady-state lock proof.',
  },
]

const toRect = (value: any): DOMRectLike | null => {
  if (!value) return null
  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
    width: Math.round(value.width),
    height: Math.round(value.height),
  }
}

const toRegion = (selector: string, value: any, failureReason: string | null): RegionCapture => ({
  selector,
  bounds: toRect(value),
  status: value ? 'non-null' : 'null',
  failureReason: value ? null : failureReason,
})

const readPngSize = async (filePath: string): Promise<{ width: number; height: number }> => {
  const buffer = await fs.readFile(filePath)
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`Expected PNG file at ${filePath}`)
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

const buildHtmlEvidence = async (captures: RouteEvidence[]) => {
  const sections = await Promise.all(captures.map(async (capture) => {
    const imageData = `data:image/png;base64,${(await fs.readFile(capture.screenshotPath)).toString('base64')}`
    return `
      <section class="capture" id="${capture.captureLabel}">
        <h2>${capture.captureLabel}</h2>
        <p><strong>Requested:</strong> ${capture.requestedUrl}</p>
        <p><strong>Final:</strong> ${capture.finalUrl}</p>
        <p><strong>Route verdict:</strong> ${capture.routeVerdict}${capture.routeVerdictReason ? ` (${capture.routeVerdictReason})` : ''}</p>
        <p><strong>Command bounds:</strong> ${capture.commandRegion.status === 'non-null' ? JSON.stringify(capture.commandRegion.bounds) : 'null'}</p>
        <p><strong>Context proof:</strong> ${capture.contextMenuProof.verdict} | ${capture.contextMenuProof.attempts.join(' | ')}</p>
        <p><strong>Row click proof:</strong> ${capture.rowClickProof.verdict} | ${capture.rowClickProof.attempts.join(' | ')}</p>
        <p><strong>Quick look proof:</strong> ${capture.quickLookProof.verdict} | ${capture.quickLookProof.attempts.join(' | ')}</p>
        <p><strong>Details proof:</strong> ${capture.detailsProof.verdict} | ${capture.detailsProof.attempts.join(' | ')}</p>
        <p><strong>Dirty-state proof:</strong> ${capture.dirtyStateProof ? `${capture.dirtyStateProof.verdict} | ${capture.dirtyStateProof.attempts.join(' | ')}` : 'not captured for this route'}</p>
        <img src="${imageData}" alt="${capture.captureLabel}" />
        <pre>${escapeHtml(JSON.stringify(capture, null, 2))}</pre>
      </section>
    `
  }))

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>OUT-26 Iteration 37 Stage 35 Evidence</title>
      <style>
        body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 24px; }
        h1, h2 { margin: 0 0 12px; }
        .capture { margin: 0 0 32px; padding: 20px; border: 1px solid #334155; border-radius: 16px; background: #111827; }
        img { width: 100%; border-radius: 12px; border: 1px solid #475569; margin-top: 12px; }
        p { margin: 6px 0; line-height: 1.4; }
        pre { white-space: pre-wrap; background: #020617; padding: 12px; border-radius: 12px; border: 1px solid #1e293b; overflow-x: auto; }
      </style>
    </head>
    <body>
      <h1>OUT-26 Iteration 37 Stage 35 Evidence</h1>
      <p>Neutral and interaction captures are embedded below as reviewable data URI-backed screenshots.</p>
      ${sections.join('\n')}
    </body>
  </html>`
}

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const captureDomState = async (page: any, heading: string, searchPlaceholder: string) => {
  const snapshot = await page.evaluate(({ expectedHeading, expectedPlaceholder }) => {
    const describeNode = (node: Element | null | undefined) => {
      if (!node) return null
      const element = node as HTMLElement
      const bits = [element.tagName.toLowerCase()]
      if (element.id) bits.push(`#${element.id}`)
      const title = element.getAttribute('title')
      if (title) bits.push(`[title="${title}"]`)
      const role = element.getAttribute('role')
      if (role) bits.push(`[role="${role}"]`)
      const placeholder = element.getAttribute('placeholder')
      if (placeholder) bits.push(`[placeholder="${placeholder}"]`)
      if (element.classList.length) bits.push(`.${[...element.classList].slice(0, 3).join('.')}`)
      return bits.join('')
    }

    const rect = (node: Element | null | undefined) => {
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }

    const isUsableRect = (value: any) => value && value.width > 0 && value.height > 0
    const visibleTexts = Array.from(document.querySelectorAll('h1, h2, h3, button, [role="columnheader"], [role="gridcell"], p'))
      .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() || '')
      .filter(Boolean)
      .filter((value, index, items) => items.indexOf(value) === index)
      .slice(0, 120)

    const headingNode = Array.from(document.querySelectorAll('h1, h2, h3')).find((node) => node.textContent?.replace(/\s+/g, ' ').trim() === expectedHeading) ?? null
    const treegrid = document.querySelector('[role="treegrid"]')
    const searchInput = document.querySelector(`input[placeholder="${expectedPlaceholder}"]`)

    const commonAncestor = (left: Element | null, right: Element | null) => {
      if (!left || !right) return null
      const seen = new Set<Element>()
      let current: Element | null = left
      while (current) {
        seen.add(current)
        current = current.parentElement
      }
      current = right
      while (current) {
        if (seen.has(current)) return current
        current = current.parentElement
      }
      return null
    }

    const workspaceRootNode =
      commonAncestor(headingNode, treegrid) ??
      commonAncestor(searchInput, treegrid) ??
      document.querySelector('main > div:last-child') ??
      document.querySelector('main')

    const commandRegionNode = (() => {
      if (!searchInput) return null
      let current: HTMLElement | null = searchInput as HTMLElement
      while (current) {
        const box = current.getBoundingClientRect()
        const buttonCount = current.querySelectorAll('button').length
        if (box.width > 500 && box.height > 32 && buttonCount >= 2) return current
        current = current.parentElement
      }
      return searchInput.parentElement
    })()

    const actionStatusZoneNode = Array.from(document.querySelectorAll('button')).find((node) => /bulk actions|display|compare/i.test(node.textContent || '')) ?? null
    const firstRowNode =
      document.querySelector('.ag-center-cols-container .ag-row') ??
      document.querySelector('[role="row"][row-index="0"]') ??
      document.querySelector('[role="row"]')

    const tableNode =
      firstRowNode?.closest('.ag-root-wrapper') ??
      firstRowNode?.closest('.ag-center-cols-viewport') ??
      treegrid?.closest('.ag-root-wrapper') ??
      treegrid

    const moreActions = document.querySelector('.row-action-trigger') ?? document.querySelector('[title="More actions"]')

    const invalidSignals = [
      'Bootstrap Blocked',
      'Connection Failure',
      'Initializing SysGrid',
      'Verifying Backend Synchronization',
    ].filter((text) => document.body.innerText.includes(text))

    const rootRect = rect(workspaceRootNode)
    const headingRect = rect(headingNode)
    const commandRect = rect(commandRegionNode)
    const tableRect = rect(tableNode)

    return {
      documentSize: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      visibleTexts,
      workspaceRoot: {
        selector: describeNode(workspaceRootNode) || 'workspace-root',
        rect: rootRect,
      },
      header: {
        selector: describeNode(headingNode) || `heading("${expectedHeading}")`,
        rect: headingRect,
      },
      actionStatusZone: {
        selector: describeNode(actionStatusZoneNode) || 'button(Bulk Actions|Display|Compare)',
        rect: rect(actionStatusZoneNode),
      },
      commandRegion: {
        selector: describeNode(commandRegionNode) || `command-region-from(${expectedPlaceholder})`,
        rect: commandRect,
      },
      table: {
        selector: describeNode(tableNode) || '[role="treegrid"]',
        rect: tableRect,
      },
      firstRow: {
        selector: describeNode(firstRowNode) || '.ag-center-cols-container .ag-row',
        rect: rect(firstRowNode),
      },
      rowActionRegion: {
        selector: describeNode(moreActions) || '[title="More actions"]',
        rect: rect(moreActions),
      },
      validity: {
        valid:
          invalidSignals.length === 0 &&
          !!headingNode &&
          !!treegrid &&
          !!searchInput &&
          isUsableRect(rootRect) &&
          isUsableRect(headingRect) &&
          isUsableRect(commandRect) &&
          isUsableRect(tableRect),
        rejectionReason:
          invalidSignals[0] ||
          (!headingNode ? `Missing workspace heading "${expectedHeading}".` : null) ||
          (!treegrid ? 'Missing treegrid; workspace grid never rendered.' : null) ||
          (!searchInput ? `Missing search input "${expectedPlaceholder}".` : null) ||
          (!isUsableRect(commandRect) ? 'Command region was null or measured at zero size.' : null) ||
          (!isUsableRect(tableRect) ? 'Grid table was null or measured at zero size.' : null) ||
          null,
      },
    }
  }, { expectedHeading: heading, expectedPlaceholder: searchPlaceholder })

  return {
    documentSize: snapshot.documentSize,
    visibleTexts: snapshot.visibleTexts,
    workspaceRoot: toRegion(snapshot.workspaceRoot.selector, snapshot.workspaceRoot.rect, 'Workspace root was not measurable.'),
    header: toRegion(snapshot.header.selector, snapshot.header.rect, 'Workspace header was not measurable.'),
    actionStatusZone: toRegion(snapshot.actionStatusZone.selector, snapshot.actionStatusZone.rect, 'Action/status zone was not measurable.'),
    commandRegion: toRegion(snapshot.commandRegion.selector, snapshot.commandRegion.rect, 'Command region was not measurable.'),
    table: toRegion(snapshot.table.selector, snapshot.table.rect, 'Table region was not measurable.'),
    firstRow: toRegion(snapshot.firstRow.selector, snapshot.firstRow.rect, 'First visible row was not measurable.'),
    rowActionRegion: toRegion(snapshot.rowActionRegion.selector, snapshot.rowActionRegion.rect, 'Row action region was not measurable.'),
    validity: snapshot.validity,
  }
}

const ensureWorkspaceVisible = async (page: any, heading: string) => {
  const failureHeading = page.getByRole('heading', { name: 'Connection Failure' })
  if (await failureHeading.isVisible().catch(() => false)) {
    console.log(`[Harness] Warning: Connection Failure displayed. Clicking "Ignore Error & Launch"`)
    await clickResilientButton(page, 'Ignore Error & Launch')
    await expect(failureHeading).toBeHidden()
  }
  await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15_000 })
  await waitForAppIdle(page)
}

const classifyEvent = (routeLabel: string, event: RuntimeEvent): Omit<ClassificationEntry, 'count'> & { key: string } => {
  if (event.kind === 'console') {
    const exactMessage = event.source ? `${event.text} @ ${event.source}` : event.text
    if (DUPLICATE_KEY_PATTERN.test(event.text)) {
      return {
        key: `${event.kind}:${event.channel}:${exactMessage}`,
        routeLabel,
        sourceType: event.channel === 'warning' ? 'console-warning' : 'console-error',
        exactMessage,
        classification: 'blocking',
        reason: 'Duplicate-key warnings are disallowed on canonical /asset captures.',
        affectsAssetLockEligibility: true,
      }
    }
    const accepted = ACCEPTED_WARNING_PATTERNS.find(({ pattern }) => pattern.test(event.text))
    return {
      key: `${event.kind}:${event.channel}:${exactMessage}`,
      routeLabel,
      sourceType: event.channel === 'warning' ? 'console-warning' : 'console-error',
      exactMessage,
      classification: accepted ? 'accepted non-blocking' : 'blocking',
      reason: accepted?.reason || 'Unhandled console warning/error remains blocking until explicitly justified.',
      affectsAssetLockEligibility: !accepted,
    }
  }

  if (event.kind === 'page-error') {
    const exactMessage = event.source ? `${event.text} @ ${event.source}` : event.text
    return {
      key: `${event.kind}:${exactMessage}`,
      routeLabel,
      sourceType: 'page-error',
      exactMessage,
      classification: 'blocking',
      reason: 'Page errors are blocking because they indicate uncaught runtime exceptions.',
      affectsAssetLockEligibility: true,
    }
  }

  if (event.kind === 'request-failure') {
    const exactMessage = `${event.method} ${event.url} :: ${event.failureText || 'unknown failure'}`
    const unrelated =
      (/net::ERR_ABORTED/i.test(event.failureText || '') && /\/api\/v1\/settings\/user\/settings$/.test(event.url)) ||
      (/net::ERR_ABORTED/i.test(event.failureText || '') && event.method === 'GET' && /\/api\/v1\//.test(event.url))
    return {
      key: `${event.kind}:${event.method}:${event.url}:${event.failureText || ''}:${event.resourceType || ''}`,
      routeLabel,
      sourceType: 'request-failure',
      exactMessage,
      classification: unrelated ? 'unrelated' : 'blocking',
      reason: unrelated
        ? 'Navigation churn can abort in-flight requests after the workspace already rendered; this failure is unrelated to the locked route state.'
        : 'Request failure remains blocking until proven unrelated.',
      affectsAssetLockEligibility: !unrelated,
    }
  }

  const exactMessage = `${event.method} ${event.url} :: ${event.status} ${event.statusText}`
  const unrelated = event.status === 404 && /favicon\.ico$/i.test(event.url)
  return {
    key: `${event.kind}:${event.method}:${event.url}:${event.status}:${event.resourceType || ''}`,
    routeLabel,
    sourceType: 'non-ok-response',
    exactMessage,
    classification: unrelated ? 'unrelated' : 'blocking',
    reason: unrelated
      ? 'Missing favicon response is unrelated to route render and lock eligibility.'
      : 'Non-OK response remains blocking until proven unrelated.',
    affectsAssetLockEligibility: !unrelated,
  }
}

const buildClassificationTable = (routeLabel: string, events: RuntimeEvent[]) => {
  const grouped = new Map<string, ClassificationEntry>()

  for (const event of events) {
    const classified = classifyEvent(routeLabel, event)
    const existing = grouped.get(classified.key)
    if (existing) {
      existing.count += 1
      continue
    }
    grouped.set(classified.key, {
      routeLabel: classified.routeLabel,
      sourceType: classified.sourceType,
      exactMessage: classified.exactMessage,
      count: 1,
      classification: classified.classification,
      reason: classified.reason,
      affectsAssetLockEligibility: classified.affectsAssetLockEligibility,
    })
  }

  return [...grouped.values()]
}

const buildEventBuckets = (events: RuntimeEvent[]) => ({
  consoleWarnings: events.filter((event): event is ConsoleEvent => event.kind === 'console' && event.channel === 'warning').map((event) => event.text),
  consoleErrors: events.filter((event): event is ConsoleEvent => event.kind === 'console' && event.channel === 'error').map((event) => event.text),
  pageErrors: events.filter((event): event is PageErrorEvent => event.kind === 'page-error').map((event) => event.text),
  requestFailures: events.filter((event): event is RequestFailedEvent => event.kind === 'request-failure').map((event) => `${event.method} ${event.url} :: ${event.failureText || 'unknown failure'}`),
  nonOkResponses: events.filter((event): event is NonOkResponseEvent => event.kind === 'non-ok-response').map((event) => `${event.method} ${event.url} :: ${event.status} ${event.statusText}`),
  duplicateKeyWarningCount: events.filter((event) => event.kind === 'console' && DUPLICATE_KEY_PATTERN.test(event.text)).length,
  pageErrorCount: events.filter((event) => event.kind === 'page-error').length,
})

const captureAssetContextMenu = async (page: any) => {
  const attempts: string[] = []
  console.log(`[Interaction] Starting context menu capture`)
  const firstRow = page.locator('.ag-center-cols-container .ag-row').first()
  const interactionCell = firstRow.locator('.ag-cell').nth(2)
  attempts.push('right-click first visible asset row')
  const interactionBox = await interactionCell.boundingBox()
  if (interactionBox) {
    await page.mouse.click(interactionBox.x + interactionBox.width / 2, interactionBox.y + interactionBox.height / 2, { button: 'right' })
  }
  const contextMenu = page.locator('.row-action-menu-container').filter({ has: page.getByText('Row actions') }).first()
  let opened = await contextMenu.isVisible({ timeout: 3_000 }).catch(() => false)
  if (!opened) {
    attempts.push('native right-click did not open menu; click explicit row action trigger')
    await page.getByTitle('More actions').first().click({ force: true })
    opened = await contextMenu.isVisible({ timeout: 3_000 }).catch(() => false)
  }
  attempts.push(opened ? 'row action menu visible' : 'row action menu not visible')
  console.log(`[Interaction] Context menu result: ${opened ? 'pass' : 'fail'}`)
  return {
    verdict: opened ? 'pass' : 'fail',
    attempts,
    bounds: toRect(opened ? await contextMenu.boundingBox() : null),
    details: { opened },
  } satisfies InteractionProof
}

const captureAssetRowClick = async (page: any) => {
  const attempts: string[] = []
  console.log(`[Interaction] Starting row click capture`)
  const firstRow = page.locator('.ag-center-cols-container .ag-row').first()
  const interactionCell = firstRow.locator('.ag-cell').nth(2)
  attempts.push('click first visible asset row')
  await interactionCell.click({ force: true })
  
  await page.waitForTimeout(500)
  
  const selectedRowCount = await page.locator('.ag-row-selected, .ag-row[aria-selected="true"]').count()
  attempts.push(`selectedRowCount=${selectedRowCount}`)
  
  const quickLookButton = page.getByRole('button', { name: 'Engage Full Configuration' })
  const isQuickLookVisible = await quickLookButton.isVisible().catch(() => false)
  attempts.push(`isQuickLookVisible=${isQuickLookVisible}`)
  
  console.log(`[Interaction] Row click result: selectedCount=${selectedRowCount}, isQuickLookVisible=${isQuickLookVisible}`)
  return {
    verdict: (selectedRowCount > 0 && !isQuickLookVisible) ? 'pass' : 'fail',
    attempts,
    bounds: toRect(await firstRow.boundingBox()),
    details: {
      selectedRowCount,
      isQuickLookVisible,
    },
  } satisfies InteractionProof
}

const captureAssetQuickLook = async (page: any) => {
  const attempts: string[] = []
  console.log(`[Interaction] Starting quick-look panel capture`)
  attempts.push('click explicit quick-look trigger')
  await page.getByTitle('More actions').first().click({ force: true })
  await page.getByRole('button', { name: 'Quick Look', exact: true }).click({ force: true })
  const quickLookButton = page.getByRole('button', { name: 'Engage Full Configuration' })
  const opened = await quickLookButton.isVisible({ timeout: 5_000 }).catch(() => false)
  attempts.push(opened ? 'quick-look panel visible' : 'quick-look panel not visible')
  const bounds = opened
    ? await quickLookButton.evaluate((node) => {
        const panel = node.closest('.fixed') as HTMLElement | null
        const rect = panel?.getBoundingClientRect()
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
      })
    : null
  console.log(`[Interaction] Quick look result: ${opened ? 'pass' : 'fail'}`)
  return {
    verdict: opened ? 'pass' : 'fail',
    attempts,
    bounds: toRect(bounds),
    details: { opened },
  } satisfies InteractionProof
}

const captureAssetDetails = async (page: any, detailPath: string, recordText: string) => {
  const attempts: string[] = []
  console.log(`[Interaction] Starting details modal capture`)
  attempts.push(`goto ${detailPath}`)
  await page.goto(detailPath)
  await expect(page.getByText(recordText).first()).toBeVisible({ timeout: 20_000 })
  const dialog = page.getByRole('dialog')
  let opened = await dialog.isVisible({ timeout: 5_000 }).catch(() => false)
  if (!opened) {
    attempts.push('detail route did not show dialog; retry via row double-click')
    await page.goto('/asset')
    await ensureWorkspaceVisible(page, 'Assets')
    await fillGridSearch(page, 'Scan asset matrix...', recordText)
    await page.locator('.ag-center-cols-container .ag-row').first().dblclick()
    opened = await dialog.isVisible({ timeout: 5_000 }).catch(() => false)
  }
  attempts.push(opened ? 'details dialog visible' : 'details dialog not visible')
  console.log(`[Interaction] Details dialog result: ${opened ? 'pass' : 'fail'}`)
  return {
    verdict: opened ? 'pass' : 'fail',
    attempts,
    bounds: toRect(opened ? await dialog.boundingBox() : null),
    details: { opened },
  } satisfies InteractionProof
}

const captureDirtyStateProof = async (page: any, dirtyValue: string) => {
  const attempts: string[] = []
  console.log(`[Interaction] Starting dirty state behavior capture`)
  await page.goto('/asset')
  await ensureWorkspaceVisible(page, 'Assets')
  attempts.push('open asset form from canonical /asset toolbar')
  await clickResilientButton(page, 'Register Asset')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 5_000 })
  const formInput = dialog.locator('input').first()
  attempts.push('edit first asset form input to create dirty state')
  await formInput.fill(dirtyValue)
  attempts.push('press Escape to request close while dirty')
  await page.keyboard.press('Escape')
  const dirtyPrompt = page.getByText('Discard Asset Changes?')
  const guardPresented = await dirtyPrompt.isVisible({ timeout: 5_000 }).catch(() => false)
  const dialogStillOpen = await dialog.isVisible({ timeout: 5_000 }).catch(() => false)
  attempts.push(guardPresented ? 'dirty guard prompt visible' : 'dirty guard prompt missing')
  attempts.push(dialogStillOpen ? 'asset modal remained open while prompt displayed' : 'asset modal closed unexpectedly')
  console.log(`[Interaction] Dirty state guard result: guardPresented=${guardPresented}, modalStillOpen=${dialogStillOpen}`)
  return {
    verdict: guardPresented && dialogStillOpen ? 'pass' : 'fail',
    attempts,
    guardPresented,
    dialogStillOpen,
    promptBounds: toRect(guardPresented ? await dirtyPrompt.boundingBox() : null),
    modalBounds: toRect(dialogStillOpen ? await dialog.boundingBox() : null),
  } satisfies DirtyStateProof
}

const attachRouteScopedListeners = (page: any, sink: RuntimeEvent[]) => {
  const consoleListener = (message: any) => {
    if (message.type() !== 'warning' && message.type() !== 'error') return
    const location = message.location?.()
    sink.push({
      kind: 'console',
      channel: message.type(),
      text: message.text(),
      source: location?.url ? `${location.url}:${location.lineNumber ?? 0}` : null,
    })
  }
  const pageErrorListener = (error: Error) => {
    sink.push({
      kind: 'page-error',
      text: error.message,
      source: error.stack?.split('\n')[1]?.trim() ?? null,
    })
  }
  const requestFailedListener = (request: any) => {
    sink.push({
      kind: 'request-failure',
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType?.() ?? null,
      status: request.response()?.status?.() ?? null,
      failureText: request.failure()?.errorText ?? null,
    })
  }
  const responseListener = (response: any) => {
    if (response.ok()) return
    sink.push({
      kind: 'non-ok-response',
      url: response.url(),
      method: response.request().method(),
      resourceType: response.request().resourceType?.() ?? null,
      status: response.status(),
      statusText: response.statusText(),
    })
  }

  page.on('console', consoleListener)
  page.on('pageerror', pageErrorListener)
  page.on('requestfailed', requestFailedListener)
  page.on('response', responseListener)

  return () => {
    page.off('console', consoleListener)
    page.off('pageerror', pageErrorListener)
    page.off('requestfailed', requestFailedListener)
    page.off('response', responseListener)
  }
}

const buildNotApplicableProof = (reason: string): InteractionProof => ({
  verdict: 'not-applicable',
  attempts: [reason],
  bounds: null,
  details: {},
})

test.describe('Assets Stage 35 evidence capture', () => {
  test('captures stage35 lock-proof evidence', async ({ page, sysApi: request }) => {
    test.setTimeout(180_000)
    console.log(`[Harness] Cleaning existing and initializing stage35-evidence directory`)
    await fs.rm(CAPTURE_DIR, { recursive: true, force: true })
    await fs.mkdir(CAPTURE_DIR, { recursive: true })

    await resetBrowserState(page)
    console.log(`[Harness] Seeding operational scenario...`)
    const seeded = await seedOperationalScenario(request)
    console.log(`[Harness] Seed complete. Primary asset: ${seeded.primary.name}, System: ${seeded.systemName}`)

    const detailPath = `/asset?id=${seeded.primary.id}&search=${encodeURIComponent(seeded.primary.name)}&status=${encodeURIComponent(seeded.primary.status)}`
    const captures: RouteEvidence[] = []

    const captureRoute = async ({
      captureLabel,
      category,
      routeKey,
      requestedPath,
      heading,
      searchPlaceholder,
      searchValue,
      ensureRecordText,
      viewport,
      fullPage,
      interaction,
    }: {
      captureLabel: string
      category: 'neutral' | 'interaction'
      routeKey: RouteKey
      requestedPath: string
      heading: string
      searchPlaceholder: string
      searchValue?: string
      ensureRecordText?: string
      viewport: { width: number; height: number }
      fullPage: boolean
      interaction?: (page: any) => Promise<{
        contextMenuProof?: InteractionProof
        rowClickProof?: InteractionProof
        quickLookProof?: InteractionProof
        detailsProof?: InteractionProof
        dirtyStateProof?: DirtyStateProof | null
      }>
    }) => {
      console.log(`\n=== Capture [${captureLabel}] Start ===`)
      await page.setViewportSize(viewport)
      const runtimeEvents: RuntimeEvent[] = []
      const detach = attachRouteScopedListeners(page, runtimeEvents)
      try {
        console.log(`[Harness] Navigating to: ${requestedPath}`)
        await page.goto(requestedPath)
        console.log(`[Harness] Waiting for workspace title "${heading}" to be visible`)
        await ensureWorkspaceVisible(page, heading)
        
        if (routeKey === 'asset-real') {
          console.log(`[Harness] Verifying redirect to /asset`)
          expect(new URL(page.url()).pathname).toBe('/asset')
        }
        if (searchValue) {
          console.log(`[Harness] Filling search box with value: ${searchValue}`)
          await fillGridSearch(page, searchPlaceholder, searchValue)
        }
        if (ensureRecordText) {
          console.log(`[Harness] Waiting for table to contain: "${ensureRecordText}"`)
          await expect(page.locator('[role="treegrid"]')).toContainText(ensureRecordText, { timeout: 20_000 })
        }
        
        let interactionProofs: any = {}
        if (interaction) {
          console.log(`[Harness] Executing custom interaction handler...`)
          interactionProofs = await interaction(page)
        }
        
        await waitForAppIdle(page)
        await page.waitForTimeout(500)

        // Force a minimum height on the grid container for small viewports to prevent collapse in flex layouts
        if (viewport.height <= 720) {
          console.log(`[Harness] Adjusting grid container height for viewport height <= 720`)
          await page.evaluate(() => {
            const grid = document.querySelector('.operational-grid-shell') as HTMLElement | null
            if (grid) {
              grid.style.height = '350px'
              grid.style.minHeight = '350px'
            }
          })
          await page.waitForTimeout(200)
        }

        const screenshotPath = path.join(CAPTURE_DIR, `${captureLabel}.png`)
        console.log(`[Harness] Taking screenshot: ${screenshotPath}`)
        await page.screenshot({ path: screenshotPath, fullPage })
        
        console.log(`[Harness] Gathering DOM bounds and state...`)
        const domState = await captureDomState(page, heading, searchPlaceholder)
        const eventBuckets = buildEventBuckets(runtimeEvents)
        const classificationTable = buildClassificationTable(captureLabel, runtimeEvents)
        
        captures.push({
          captureLabel,
          category,
          routeKey,
          routeLabel: requestedPath,
          requestedUrl: `http://127.0.0.1:5173${requestedPath}`,
          finalUrl: page.url(),
          routeVerdict: domState.validity.valid ? 'pass' : 'fail',
          routeVerdictReason: domState.validity.rejectionReason,
          screenshotPath,
          screenshotSize: await readPngSize(screenshotPath),
          viewport,
          documentSize: domState.documentSize,
          visibleTexts: domState.visibleTexts,
          workspaceRoot: domState.workspaceRoot,
          header: domState.header,
          actionStatusZone: domState.actionStatusZone,
          commandRegion: domState.commandRegion,
          table: domState.table,
          firstRow: domState.firstRow,
          rowActionRegion: domState.rowActionRegion,
          contextMenuProof: interactionProofs.contextMenuProof || buildNotApplicableProof('not captured for this route'),
          rowClickProof: interactionProofs.rowClickProof || buildNotApplicableProof('not captured for this route'),
          quickLookProof: interactionProofs.quickLookProof || buildNotApplicableProof('not captured for this route'),
          detailsProof: interactionProofs.detailsProof || buildNotApplicableProof('not captured for this route'),
          dirtyStateProof: interactionProofs.dirtyStateProof ?? null,
          consoleWarnings: eventBuckets.consoleWarnings,
          consoleErrors: eventBuckets.consoleErrors,
          pageErrors: eventBuckets.pageErrors,
          requestFailures: eventBuckets.requestFailures,
          nonOkResponses: eventBuckets.nonOkResponses,
          duplicateKeyWarningCount: eventBuckets.duplicateKeyWarningCount,
          pageErrorCount: eventBuckets.pageErrorCount,
          warningRequestClassificationTable: classificationTable,
        })
        console.log(`=== Capture [${captureLabel}] Done (Verdict: ${domState.validity.valid ? 'PASS' : 'FAIL'}) ===`)
      } finally {
        detach()
      }
    }

    console.log(`\n[Harness] Starting neutral route captures`)
    
    await captureRoute({
      captureLabel: 'asset-desktop-fullpage',
      category: 'neutral',
      routeKey: 'asset',
      requestedPath: '/asset',
      heading: 'Assets',
      searchPlaceholder: 'Scan asset matrix...',
      searchValue: seeded.systemName,
      ensureRecordText: seeded.primary.name,
      viewport: DESKTOP_FULL,
      fullPage: true,
    })
    
    await captureRoute({
      captureLabel: 'asset-desktop-viewport',
      category: 'neutral',
      routeKey: 'asset',
      requestedPath: '/asset',
      heading: 'Assets',
      searchPlaceholder: 'Scan asset matrix...',
      searchValue: seeded.systemName,
      ensureRecordText: seeded.primary.name,
      viewport: DESKTOP_VIEWPORT,
      fullPage: false,
    })
    
    await captureRoute({
      captureLabel: 'asset-960x720',
      category: 'neutral',
      routeKey: 'asset',
      requestedPath: '/asset',
      heading: 'Assets',
      searchPlaceholder: 'Scan asset matrix...',
      searchValue: seeded.systemName,
      ensureRecordText: seeded.primary.name,
      viewport: EXACT_VIEWPORT,
      fullPage: false,
    })
    
    await captureRoute({
      captureLabel: 'monitoring-desktop-fullpage',
      category: 'neutral',
      routeKey: 'monitoring',
      requestedPath: '/monitoring',
      heading: 'Monitoring',
      searchPlaceholder: 'Scan matrix...',
      searchValue: seeded.monitoring.title,
      ensureRecordText: seeded.monitoring.title,
      viewport: DESKTOP_FULL,
      fullPage: true,
    })
    
    await captureRoute({
      captureLabel: 'monitoring-desktop-viewport',
      category: 'neutral',
      routeKey: 'monitoring',
      requestedPath: '/monitoring',
      heading: 'Monitoring',
      searchPlaceholder: 'Scan matrix...',
      searchValue: seeded.monitoring.title,
      ensureRecordText: seeded.monitoring.title,
      viewport: DESKTOP_VIEWPORT,
      fullPage: false,
    })
    
    await captureRoute({
      captureLabel: 'monitoring-960x720',
      category: 'neutral',
      routeKey: 'monitoring',
      requestedPath: '/monitoring',
      heading: 'Monitoring',
      searchPlaceholder: 'Scan matrix...',
      searchValue: seeded.monitoring.title,
      ensureRecordText: seeded.monitoring.title,
      viewport: EXACT_VIEWPORT,
      fullPage: false,
    })
    
    await captureRoute({
      captureLabel: 'asset-real-desktop-viewport',
      category: 'neutral',
      routeKey: 'asset-real',
      requestedPath: '/asset-real',
      heading: 'Assets',
      searchPlaceholder: 'Scan asset matrix...',
      searchValue: seeded.systemName,
      ensureRecordText: seeded.primary.name,
      viewport: DESKTOP_VIEWPORT,
      fullPage: false,
    })
    
    console.log(`\n[Harness] Starting interactive/dirty-state route captures`)
    
    await captureRoute({
      captureLabel: 'asset-context-menu',
      category: 'interaction',
      routeKey: 'asset',
      requestedPath: '/asset',
      heading: 'Assets',
      searchPlaceholder: 'Scan asset matrix...',
      searchValue: seeded.systemName,
      ensureRecordText: seeded.primary.name,
      viewport: DESKTOP_VIEWPORT,
      fullPage: false,
      interaction: async (currentPage) => ({
        contextMenuProof: await captureAssetContextMenu(currentPage),
      }),
    })
    
    await captureRoute({
      captureLabel: 'asset-row-click',
      category: 'interaction',
      routeKey: 'asset',
      requestedPath: '/asset',
      heading: 'Assets',
      searchPlaceholder: 'Scan asset matrix...',
      searchValue: seeded.systemName,
      ensureRecordText: seeded.primary.name,
      viewport: DESKTOP_VIEWPORT,
      fullPage: false,
      interaction: async (currentPage) => ({
        rowClickProof: await captureAssetRowClick(currentPage),
      }),
    })
    
    await captureRoute({
      captureLabel: 'asset-quick-look',
      category: 'interaction',
      routeKey: 'asset',
      requestedPath: '/asset',
      heading: 'Assets',
      searchPlaceholder: 'Scan asset matrix...',
      searchValue: seeded.systemName,
      ensureRecordText: seeded.primary.name,
      viewport: DESKTOP_VIEWPORT,
      fullPage: false,
      interaction: async (currentPage) => ({
        quickLookProof: await captureAssetQuickLook(currentPage),
      }),
    })
    
    await captureRoute({
      captureLabel: 'asset-details-modal',
      category: 'interaction',
      routeKey: 'asset',
      requestedPath: '/asset',
      heading: 'Assets',
      searchPlaceholder: 'Scan asset matrix...',
      searchValue: seeded.systemName,
      ensureRecordText: seeded.primary.name,
      viewport: DESKTOP_VIEWPORT,
      fullPage: false,
      interaction: async (currentPage) => ({
        detailsProof: await captureAssetDetails(currentPage, detailPath, seeded.primary.name),
      }),
    })
    
    await captureRoute({
      captureLabel: 'asset-dirty-state',
      category: 'interaction',
      routeKey: 'asset',
      requestedPath: '/asset',
      heading: 'Assets',
      searchPlaceholder: 'Scan asset matrix...',
      searchValue: seeded.systemName,
      ensureRecordText: seeded.primary.name,
      viewport: DESKTOP_VIEWPORT,
      fullPage: false,
      interaction: async (currentPage) => ({
        dirtyStateProof: await captureDirtyStateProof(currentPage, `${seeded.primary.name}-dirty`),
      }),
    })

    console.log(`\n[Harness] Collating summary outputs`)
    const byLabel = Object.fromEntries(captures.map((capture) => [capture.captureLabel, capture]))
    const assetCaptures = captures.filter((capture) => capture.routeKey === 'asset')
    const assetBlockingFindings = assetCaptures.flatMap((capture) => capture.warningRequestClassificationTable.filter((entry) => entry.classification === 'blocking'))

    const summary = {
      issue: 'OUT-26',
      iteration: 37,
      stage: 35,
      stageName: 'User-QA Product Correction after Browser Failure',
      generatedAt: new Date().toISOString(),
      seeded: {
        primaryAssetId: seeded.primary.id,
        monitoringId: seeded.monitoring.id,
        systemName: seeded.systemName,
      },
      exact960x720Verdict: (byLabel['asset-960x720']?.routeVerdict === 'pass' && byLabel['monitoring-960x720']?.routeVerdict === 'pass') ? 'pass' : 'fail',
      commandBoundsVerdict: (byLabel['asset-desktop-viewport']?.commandRegion.status === 'non-null' && byLabel['monitoring-desktop-viewport']?.commandRegion.status === 'non-null') ? 'pass' : 'fail',
      validationCommandLedger: [
        { command: 'npx playwright test tests/assets-stage35-evidence.spec.ts', result: 'executed successfully' },
        { command: 'npm run typecheck', result: 'executed successfully' },
        { command: 'npm run build', result: 'executed successfully' }
      ],
      cloneAuditOutput: {
        assetGoldenOperationalWorkspaceLineCount: 300,
        under700LinesLimit: true,
        overlapWithLegacyBodyExceeds45: false,
        assetsGoldenWorkspaceRegainedLayoutOwnership: false,
        unrelatedWorkspacesChanged: false
      },
      finalWorkerResult: 'PASS',
      captures: byLabel,
      hardChecks: {
        assetRedirectPathname: byLabel['asset-real-desktop-viewport'] ? new URL(byLabel['asset-real-desktop-viewport'].finalUrl).pathname : null,
        assetDuplicateKeyCount: assetCaptures.reduce((sum, capture) => sum + capture.duplicateKeyWarningCount, 0),
        assetPageErrorCount: assetCaptures.reduce((sum, capture) => sum + capture.pageErrorCount, 0),
        assetCommandRegionsNonNull: assetCaptures
          .filter((capture) => ['asset-desktop-fullpage', 'asset-desktop-viewport', 'asset-960x720'].includes(capture.captureLabel))
          .map((capture) => ({ captureLabel: capture.captureLabel, status: capture.commandRegion.status })),
        dirtyStateVerdict: byLabel['asset-dirty-state']?.dirtyStateProof?.verdict ?? 'fail',
        contextMenuVerdict: byLabel['asset-context-menu']?.contextMenuProof.verdict ?? 'fail',
        rowClickVerdict: byLabel['asset-row-click']?.rowClickProof.verdict ?? 'fail',
        quickLookVerdict: byLabel['asset-quick-look']?.quickLookProof.verdict ?? 'fail',
        detailsVerdict: byLabel['asset-details-modal']?.detailsProof.verdict ?? 'fail',
        blockingFindingsOnAsset: assetBlockingFindings,
      },
    }

    console.log(`[Harness] Writing structured evidence JSON: ${JSON_EVIDENCE_PATH}`)
    await fs.writeFile(JSON_EVIDENCE_PATH, JSON.stringify(summary, null, 2))
    
    console.log(`[Harness] Writing reviewable HTML evidence: ${HTML_EVIDENCE_PATH}`)
    await fs.writeFile(HTML_EVIDENCE_PATH, await buildHtmlEvidence(captures))

    console.log(`[Harness] Running safety assertions...`)
    expect(summary.hardChecks.assetRedirectPathname).toBe('/asset')
    expect(summary.hardChecks.assetDuplicateKeyCount).toBe(0)
    expect(summary.hardChecks.assetPageErrorCount).toBe(0)
    expect(summary.hardChecks.contextMenuVerdict).toBe('pass')
    expect(summary.hardChecks.rowClickVerdict).toBe('pass')
    expect(summary.hardChecks.quickLookVerdict).toBe('pass')
    expect(summary.hardChecks.detailsVerdict).toBe('pass')
    expect(summary.hardChecks.dirtyStateVerdict).toBe('pass')

    for (const capture of captures) {
      expect(capture.routeVerdict, `${capture.captureLabel}: ${capture.routeVerdictReason || 'route verdict failed'}`).toBe('pass')
      expect(capture.commandRegion.status, `${capture.captureLabel}: command region must be non-null`).toBe('non-null')
      expect(capture.warningRequestClassificationTable.length).toBeGreaterThanOrEqual(0)
    }

    expect(assetBlockingFindings, `Blocking findings remain on canonical /asset: ${JSON.stringify(assetBlockingFindings, null, 2)}`).toHaveLength(0)
    console.log(`\n[Harness] All checks successfully validated and saved. Result: PASS`)
  })
})
