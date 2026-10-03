import { expect } from '@playwright/test'
import { test } from './helpers/sysgrid-test'
import { resetBrowserState } from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'
type MotionSamples = Record<'panel' | 'confirm', {
  samples: number
  transformed: number
  faded: number
  examples: Array<{ transform: string; opacity: string }>
}>
declare global {
  interface Window {
    __sysgridModalMotionProof: MotionSamples
    __stopSysgridModalMotionProof: () => void
  }
}

for (const theme of ['nordic-frost-v1', 'pure-clarity']) {
  for (const reducedMotion of ['reduce', 'no-preference'] as const) {
    test(`shared modal and dirty confirmation respect ${reducedMotion} in ${theme}`, async ({ page, sysApi: request }, testInfo) => {
      await resetBrowserState(page)
      await page.emulateMedia({ reducedMotion })
      expect((await request.patch(`${apiBase}/settings/user/settings`, { data: { theme } })).ok()).toBeTruthy()
      await page.addInitScript(value => localStorage.setItem('sysgrid-theme', value), theme)
      await page.addInitScript(() => {
        const result: MotionSamples = {
          panel: { samples: 0, transformed: 0, faded: 0, examples: [] },
          confirm: { samples: 0, transformed: 0, faded: 0, examples: [] },
        }
        window.__sysgridModalMotionProof = result
        let stopped = false
        const sample = () => {
          for (const element of document.querySelectorAll('[data-workspace-modal-root] > .glass-panel, [data-workspace-modal-root] [role="alertdialog"]')) {
            const group = result[element.getAttribute('role') === 'alertdialog' ? 'confirm' : 'panel']
            const style = getComputedStyle(element)
            const transformed = !new DOMMatrixReadOnly(style.transform).isIdentity
            const faded = Number(style.opacity) < 1
            group.samples++
            if (transformed) group.transformed++
            if (faded) group.faded++
            if ((transformed || faded) && group.examples.length < 8) group.examples.push({ transform: style.transform, opacity: style.opacity })
          }
        }
        const observer = new MutationObserver(sample)
        observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
        const frame = () => {
          if (stopped) return
          sample()
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
        window.__stopSysgridModalMotionProof = () => { stopped = true; observer.disconnect() }
      })
      await page.goto('/asset')
      const opener = page.getByRole('button', { name: 'Import asset rows', exact: true })
      await opener.click()
      const dialog = page.getByRole('dialog', { name: 'Assets Import', exact: true })
      await expect(dialog.locator(':scope > .glass-panel')).toHaveCSS('opacity', '1')
      await dialog.getByRole('button', { name: 'Paste CSV / Grid', exact: true }).click()
      const draft = dialog.getByPlaceholder('Paste CSV with headers, or paste spreadsheet cells directly...')
      await draft.fill('name,system\nPreserved motion draft,Motion proof')
      const close = dialog.getByTitle('Close', { exact: true })
      await close.click()
      const confirm = page.getByRole('alertdialog', { name: 'Unsaved Changes', exact: true })
      await expect(confirm).toHaveCSS('opacity', '1')
      await expect(confirm.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(confirm.getByRole('button', { name: 'Discard Changes', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(confirm.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused()
      await page.screenshot({ path: testInfo.outputPath(`modal-confirm-${theme}-${reducedMotion}.png`), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await expect(confirm).toHaveCount(0)
      await expect(close).toBeFocused()
      await expect(draft).toHaveValue('name,system\nPreserved motion draft,Motion proof')
      await close.click()
      await confirm.getByRole('button', { name: 'Discard Changes', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
      const samples = await page.evaluate(() => {
        window.__stopSysgridModalMotionProof()
        return window.__sysgridModalMotionProof
      })
      await testInfo.attach('modal-motion-samples', { body: JSON.stringify({ reducedMotion, samples }), contentType: 'application/json' })
      for (const group of Object.values(samples)) {
        expect(group.samples).toBeGreaterThan(0)
        if (reducedMotion === 'reduce') {
          expect.soft(group.transformed, JSON.stringify(group.examples)).toBe(0)
          expect.soft(group.faded, JSON.stringify(group.examples)).toBe(0)
        } else {
          expect(group.transformed).toBeGreaterThan(0)
          expect(group.faded).toBeGreaterThan(0)
        }
      }
    })
  }
}
