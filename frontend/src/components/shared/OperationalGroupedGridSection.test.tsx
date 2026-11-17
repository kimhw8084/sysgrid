import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationalGroupedGridSection } from './OperationalWorkspaceShells'

describe('OperationalGroupedGridSection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('mounts the group grid when the expanded section approaches the viewport', () => {
    const observers: Array<{ callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn>; observe: ReturnType<typeof vi.fn>; options?: IntersectionObserverInit }> = []
    class MockIntersectionObserver {
      callback: IntersectionObserverCallback
      disconnect = vi.fn()
      options?: IntersectionObserverInit
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.callback = callback
        this.options = options
        observers.push(this)
      }
      observe = vi.fn()
      unobserve = vi.fn()
      takeRecords = vi.fn(() => [])
      root = null
      rootMargin = '160px 0px'
      thresholds = [0]
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

    render(
      <OperationalGroupedGridSection
        labelMeta="System"
        label="Core"
        count={24}
        countLabel="assets"
        collapsed={false}
        onToggle={vi.fn()}
        estimatedHeight={320}
      >
        <div data-testid="group-grid">Core assets</div>
      </OperationalGroupedGridSection>,
    )

    expect(screen.getByRole('heading', { name: 'Core' })).toBeInTheDocument()
    expect(screen.queryByTestId('group-grid')).not.toBeInTheDocument()
    expect(observers).toHaveLength(1)
    expect(observers[0].observe).toHaveBeenCalledOnce()
    expect(observers[0].options?.root).toBeNull()
    expect(observers[0].options?.rootMargin).toBe('160px 0px')

    act(() => observers[0].callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(screen.getByTestId('group-grid')).toBeInTheDocument()
    expect(observers[0].disconnect).toHaveBeenCalled()
  })

  it('keeps collapsed groups unmounted', () => {
    const observer = vi.fn()
    vi.stubGlobal('IntersectionObserver', observer)
    render(
      <OperationalGroupedGridSection
        labelMeta="System"
        label="Archive"
        count={2}
        countLabel="assets"
        collapsed
        onToggle={vi.fn()}
      >
        <div data-testid="group-grid">Archive assets</div>
      </OperationalGroupedGridSection>,
    )
    expect(screen.getByRole('button', { name: /Archive/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('group-grid')).not.toBeInTheDocument()
    expect(observer).not.toHaveBeenCalled()
  })

  it('keeps an uninitialized group closed until its parent chooses the initial open group', () => {
    const observer = vi.fn()
    vi.stubGlobal('IntersectionObserver', observer)
    render(
      <OperationalGroupedGridSection labelMeta="System" label="New group" count={9} countLabel="assets" onToggle={vi.fn()}>
        <div data-testid="group-grid">New group assets</div>
      </OperationalGroupedGridSection>,
    )

    expect(screen.getByRole('button', { name: /New group/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('group-grid')).not.toBeInTheDocument()
    expect(observer).not.toHaveBeenCalled()
  })

  it('uses the grouped workspace scroller as the lazy-grid observer root', () => {
    let options: IntersectionObserverInit | undefined
    class MockIntersectionObserver {
      root = null
      rootMargin = ''
      thresholds = [0]
      constructor(_callback: IntersectionObserverCallback, nextOptions?: IntersectionObserverInit) {
        options = nextOptions
      }
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
      takeRecords = vi.fn(() => [])
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    const { container } = render(
      <div data-slot="workspace-body">
        <OperationalGroupedGridSection labelMeta="System" label="Core" count={2} countLabel="assets" collapsed={false} onToggle={vi.fn()}>
          <div data-testid="group-grid">Core assets</div>
        </OperationalGroupedGridSection>
      </div>,
    )

    expect(options?.root).toBe(container.firstElementChild)
  })
})
