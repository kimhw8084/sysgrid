import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'

import { RouteFocusLocation, useRouteFocus } from './routeFocus'

const RouteFocusHarness = ({ location }: { location: RouteFocusLocation }) => {
  const mainContentRef = useRef<HTMLDivElement>(null)
  useRouteFocus(location, mainContentRef)

  return <div ref={mainContentRef} tabIndex={-1} data-testid="main-content" />
}

describe('useRouteFocus', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('focuses the main content on pathname transitions but not query-only navigation', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const { rerender } = render(
      <RouteFocusHarness location={{ pathname: '/projects', search: '' }} />,
    )

    expect(focus).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })

    rerender(
      <RouteFocusHarness location={{ pathname: '/projects', search: '?view=reports' }} />,
    )
    expect(focus).toHaveBeenCalledTimes(1)

    rerender(
      <RouteFocusHarness location={{ pathname: '/settings', search: '' }} />,
    )
    expect(focus).toHaveBeenCalledTimes(2)
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
  })
})
