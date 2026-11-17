import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'

const appStylesheet = readFileSync('src/index.css', 'utf8')
const revealRule = appStylesheet.match(
  /button\[class~="opacity-0"\]\[class~="group-hover:opacity-100"\]:not\(:disabled\):not\(\[hidden\]\):not\(\[aria-hidden="true"\]\):not\(\[inert\]\):not\(\[aria-hidden="true"\] \*\):not\(\[inert\] \*\):focus-visible\s*\{[^}]*\}/,
)
const sharedFocusRule = appStylesheet.match(
  /:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\) !important;\s*outline-offset:\s*2px;\s*\}/,
)
const revealSelector = revealRule?.[0].split('{')[0].trim() ?? ''
const revealStateSelector = revealSelector.replace(/:focus-visible$/, '')
let injectedStyle: HTMLStyleElement | undefined

afterEach(() => {
  injectedStyle?.remove()
  injectedStyle = undefined
  document.body.replaceChildren()
  document.documentElement.style.removeProperty('--focus-ring')
})

describe('hover-revealed row actions', () => {
  it('reveals only matching actions on keyboard focus and keeps the shared focus ring', async () => {
    expect(revealRule?.[0]).toContain('opacity: 1')
    expect(sharedFocusRule?.[0]).toContain('var(--focus-ring)')

    document.documentElement.style.setProperty('--focus-ring', 'rgb(37, 99, 235)')
    injectedStyle = document.createElement('style')
    injectedStyle.textContent = `
      .opacity-0 { opacity: 0; }
      .group-hover\\:opacity-100:hover { opacity: 1; }
      ${sharedFocusRule?.[0] ?? ''}
      ${revealRule?.[0] ?? ''}
    `
    document.head.append(injectedStyle)
    document.body.innerHTML = `
      <button type="button" class="opacity-0 group-hover:opacity-100">Remove logic entry</button>
      <button type="button" class="opacity-0">Unrelated hidden control</button>
      <button type="button" class="opacity-0 group-hover:opacity-100" aria-disabled="true">Unavailable but focusable action</button>
      <button type="button" class="opacity-0 group-hover:opacity-100" disabled>Disabled action</button>
      <button type="button" class="opacity-0 group-hover:opacity-100" hidden>Hidden action</button>
      <button type="button" class="opacity-0 group-hover:opacity-100" aria-hidden="true">ARIA-hidden action</button>
      <button type="button" class="opacity-0 group-hover:opacity-100" inert>Inert action</button>
      <div aria-hidden="true"><button type="button" class="opacity-0 group-hover:opacity-100">Nested ARIA-hidden action</button></div>
      <div inert><button type="button" class="opacity-0 group-hover:opacity-100">Nested inert action</button></div>
    `

    const [contextualAction, unrelatedControl, ariaDisabledAction, disabledAction, hiddenAction, ariaHiddenAction, inertAction, nestedAriaHiddenAction, nestedInertAction] = Array.from(document.querySelectorAll('button'))
    const parsedRevealRule = Array.from(injectedStyle.sheet?.cssRules ?? []).find(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === revealRule?.[0].split('{')[0].trim(),
    )
    expect(parsedRevealRule?.style.getPropertyValue('opacity')).toBe('1')
    expect(parsedRevealRule?.style.getPropertyPriority('opacity')).toBe('important')
    const user = userEvent.setup()
    await user.tab()

    expect(document.activeElement).toBe(contextualAction)
    expect(contextualAction.matches(':focus-visible')).toBe(true)
    expect(contextualAction.matches(revealSelector)).toBe(true)
    expect(sharedFocusRule?.[0]).toContain('outline: 2px solid var(--focus-ring)')

    await user.tab()
    expect(document.activeElement).toBe(unrelatedControl)
    expect(unrelatedControl.matches(revealSelector)).toBe(false)

    // aria-disabled controls remain keyboard-focusable so their disabled reason can be discovered.
    expect(ariaDisabledAction.matches(revealStateSelector)).toBe(true)

    disabledAction.focus()
    expect(document.activeElement).not.toBe(disabledAction)
    for (const excluded of [disabledAction, hiddenAction, ariaHiddenAction, inertAction, nestedAriaHiddenAction, nestedInertAction]) {
      expect(excluded.matches(revealStateSelector)).toBe(false)
    }
  })
})
