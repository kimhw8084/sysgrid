import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OperationalAnchoredPanel, OperationalSavedViewsPanel } from './OperationalWorkspaceShells'
import { computeWorkspaceAnchoredPanelStyle, shouldIgnoreWorkspaceAnchoredScroll, useWorkspaceAnchoredLayer, WorkspaceFloatingPanel } from './OperationalWorkspacePrimitives'
import { useOperationalDismissController } from './OperationalGridInteractions'

const remoteView = {
  id: '11',
  name: 'Operations focus',
  scope: 'personal' as const,
  source: 'remote' as const,
  config: { groupBy: 'status' },
}

const baseProps = {
  isOpen: true,
  panelStyle: {},
  entityLabel: 'Monitoring',
  onClose: vi.fn(),
  activeViewId: '11',
  currentViewName: 'Operations focus',
  newViewName: '',
  onNewViewNameChange: vi.fn(),
  onCreateView: vi.fn(),
  onApplySystemDefault: vi.fn(),
  savedViews: [remoteView],
  defaultViewIds: new Set<string>(),
  onApplyView: vi.fn(),
  onOverwriteView: vi.fn(),
  onDeleteView: vi.fn(),
  describeView: () => 'Grouped by status',
}

describe('OperationalSavedViewsPanel collaborative UX', () => {
  it('keeps legacy workspace panels unchanged until they opt into collaborative state', () => {
    render(<OperationalSavedViewsPanel {...baseProps} />)

    expect(screen.queryByTestId('workspace-view-sync-status')).not.toBeInTheDocument()
    expect(screen.getByText('Custom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save New' })).toBeInTheDocument()
  })

  it('shows sync and personal scope status with stable-link action', () => {
    const onCopyViewLink = vi.fn()
    render(<OperationalSavedViewsPanel {...baseProps} syncStatus="synced" onCopyViewLink={onCopyViewLink} />)

    expect(screen.getByTestId('workspace-view-sync-status')).toHaveTextContent('Synced')
    expect(screen.getByText('Personal')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(onCopyViewLink).toHaveBeenCalledWith('11')
  })

  it('submits the current DOM draft during a rapid fill and confirm', async () => {
    const onRenameView = vi.fn().mockResolvedValue(true)
    render(<OperationalSavedViewsPanel {...baseProps} onRenameView={onRenameView} />)

    fireEvent.click(screen.getByTitle('Rename Operations focus'))
    const input = screen.getByLabelText('Rename personal view')
    fireEvent.input(input, { target: { value: 'Incident command' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rename Operations focus' }))

    await waitFor(() => expect(onRenameView).toHaveBeenCalledWith('11', 'Incident command'))
    await waitFor(() => expect(screen.queryByLabelText('Rename personal view')).not.toBeInTheDocument())
  })

  it('submits the live browser-owned DOM value even without a React input update', async () => {
    const onRenameView = vi.fn().mockResolvedValue(true)
    render(<OperationalSavedViewsPanel {...baseProps} onRenameView={onRenameView} />)

    fireEvent.click(screen.getByTitle('Rename Operations focus'))
    const input = screen.getByLabelText('Rename personal view') as HTMLInputElement
    const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    nativeValueSetter?.call(input, 'Browser-owned incident command')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rename Operations focus' }))

    await waitFor(() => expect(onRenameView).toHaveBeenCalledWith('11', 'Browser-owned incident command'))
  })

  it('keeps the draft visible and controls disabled until persistence succeeds', async () => {
    let resolveRename: ((value: boolean) => void) | undefined
    const onRenameView = vi.fn(() => new Promise<boolean>((resolve) => { resolveRename = resolve }))
    render(<OperationalSavedViewsPanel {...baseProps} onRenameView={onRenameView} />)

    fireEvent.click(screen.getByTitle('Rename Operations focus'))
    fireEvent.input(screen.getByLabelText('Rename personal view'), { target: { value: 'Incident command' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rename Operations focus' }))

    expect(screen.getByLabelText('Rename personal view')).toHaveValue('Incident command')
    expect(screen.getByLabelText('Rename personal view')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Confirm rename Operations focus' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel rename Operations focus' })).toBeDisabled()

    await act(async () => { resolveRename?.(true) })
    await waitFor(() => expect(screen.queryByLabelText('Rename personal view')).not.toBeInTheDocument())
  })

  it('preserves the entered draft when persistence fails', async () => {
    const onRenameView = vi.fn().mockResolvedValue(false)
    render(<OperationalSavedViewsPanel {...baseProps} onRenameView={onRenameView} />)

    fireEvent.click(screen.getByTitle('Rename Operations focus'))
    fireEvent.input(screen.getByLabelText('Rename personal view'), { target: { value: 'Incident command' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rename Operations focus' }))

    await waitFor(() => expect(onRenameView).toHaveBeenCalledWith('11', 'Incident command'))
    expect(screen.getByLabelText('Rename personal view')).toHaveValue('Incident command')
    expect(screen.getByRole('button', { name: 'Confirm rename Operations focus' })).toBeEnabled()
  })

  it('keeps an inline rename open while a newly created view becomes active', async () => {
    const onRenameView = vi.fn().mockResolvedValue(true)
    const { rerender } = render(
      <OperationalSavedViewsPanel
        {...baseProps}
        activeViewId={null}
        currentViewName="Unsaved working view"
        onRenameView={onRenameView}
      />,
    )

    fireEvent.click(screen.getByTitle('Rename Operations focus'))
    const input = screen.getByLabelText('Rename personal view') as HTMLInputElement
    const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    nativeValueSetter?.call(input, 'Incident command')

    rerender(
      <OperationalSavedViewsPanel
        {...baseProps}
        activeViewId="11"
        currentViewName="Operations focus"
        onRenameView={onRenameView}
      />,
    )

    expect(screen.getByLabelText('Rename personal view')).toHaveValue('Incident command')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rename Operations focus' }))
    await waitFor(() => expect(onRenameView).toHaveBeenCalledWith('11', 'Incident command'))
  })

  it('offers explicit conflict recovery actions', () => {
    const onReloadConflict = vi.fn()
    const onSaveConflictCopy = vi.fn()
    render(
      <OperationalSavedViewsPanel
        {...baseProps}
        syncStatus="conflict"
        conflictMessage="The server has revision 4."
        onReloadConflict={onReloadConflict}
        onSaveConflictCopy={onSaveConflictCopy}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('The server has revision 4.')
    fireEvent.click(screen.getByRole('button', { name: 'Reload server copy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save personal copy' }))
    expect(onReloadConflict).toHaveBeenCalledTimes(1)
    expect(onSaveConflictCopy).toHaveBeenCalledTimes(1)
  })
})


function AnchoredPanelHarness({ label = 'Panel content' }: { label?: string }) {
  const { triggerRef, panelRef, panelStyle } = useWorkspaceAnchoredLayer(true, { minWidth: 240 })
  return (
    <>
      <button ref={triggerRef as React.RefObject<HTMLButtonElement>} data-testid="anchor-trigger">Anchor</button>
      <OperationalAnchoredPanel
        isOpen
        panelKey="views-harness"
        style={panelStyle}
        panelRef={panelRef}
      >
        <WorkspaceFloatingPanel>
          <div data-testid="panel-scroll-source">{label}</div>
        </WorkspaceFloatingPanel>
      </OperationalAnchoredPanel>
    </>
  )
}

function DismissLockHarness({ locked }: { locked: boolean }) {
  const [open, setOpen] = React.useState(true)
  const bulkMenuButtonRef = React.useRef<HTMLElement | null>(null)
  const bulkMenuPanelRef = React.useRef<HTMLElement | null>(null)
  const displayMenuButtonRef = React.useRef<HTMLElement | null>(null)
  const displayMenuPanelRef = React.useRef<HTMLElement | null>(null)
  const viewsMenuButtonRef = React.useRef<HTMLElement | null>(null)
  const viewsMenuPanelRef = React.useRef<HTMLElement | null>(null)

  useOperationalDismissController({
    active: open,
    onDismiss: () => setOpen(false),
    allTriggerRefs: [viewsMenuButtonRef],
    bulkMenuButtonRef,
    bulkMenuPanelRef,
    displayMenuButtonRef,
    displayMenuPanelRef,
    viewsMenuButtonRef,
    viewsMenuPanelRef,
    showBulkMenu: false,
    showDisplayMenu: false,
    showViewsMenu: open,
    hasRowActionMenu: false,
  })

  return (
    <>
      <button type="button" data-testid="dismiss-outside">Outside</button>
      <button ref={viewsMenuButtonRef as React.RefObject<HTMLButtonElement>} type="button">Views</button>
      {open ? (
        <div
          ref={viewsMenuPanelRef as React.RefObject<HTMLDivElement>}
          data-testid="dismiss-panel"
          data-workspace-panel="true"
          data-workspace-interaction-lock={locked ? 'true' : undefined}
        >
          Panel
        </div>
      ) : null}
      <output data-testid="dismiss-state">{open ? 'open' : 'closed'}</output>
    </>
  )
}

describe('Operational anchored-panel interaction continuity', () => {
  it('keeps a usable placement and flips when resizing or scrolling removes its space', () => {
    const first = computeWorkspaceAnchoredPanelStyle({
      triggerRect: { top: 120, right: 220, bottom: 160, left: 100, width: 120 },
      viewportWidth: 800,
      viewportHeight: 600,
      offset: 8,
      minWidth: 240,
      placement: null,
    })
    expect(first.placement).toBe('below')
    expect(first.style).toMatchObject({ top: 168, left: 100, width: 240, maxHeight: 420, overflowY: 'auto' })

    const moved = computeWorkspaceAnchoredPanelStyle({
      triggerRect: { top: 500, right: 220, bottom: 540, left: 100, width: 120 },
      viewportWidth: 800,
      viewportHeight: 600,
      offset: 8,
      minWidth: 240,
      placement: first.placement,
    })
    expect(moved.placement).toBe('above')
    expect(moved.style.top).toBeUndefined()
    expect(moved.style.bottom).toBe(108)
    expect(moved.style.maxHeight).toBe(480)
  })

  it('classifies only panel-descendant scroll as internal', () => {
    const panel = document.createElement('div')
    const child = document.createElement('div')
    const outside = document.createElement('div')
    panel.appendChild(child)
    expect(shouldIgnoreWorkspaceAnchoredScroll(child, panel)).toBe(true)
    expect(shouldIgnoreWorkspaceAnchoredScroll(panel, panel)).toBe(true)
    expect(shouldIgnoreWorkspaceAnchoredScroll(outside, panel)).toBe(false)
    expect(shouldIgnoreWorkspaceAnchoredScroll(window, panel)).toBe(false)
  })
  it('ignores panel-internal scroll while still tracking external viewport scroll', async () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if ((this as HTMLElement).dataset.testid === 'anchor-trigger') {
        return {
          x: 100,
          y: 120,
          top: 120,
          right: 220,
          bottom: 160,
          left: 100,
          width: 120,
          height: 40,
          toJSON: () => ({}),
        } as DOMRect
      }
      return {
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
    class ResizeObserverStub {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }
    window.cancelAnimationFrame = () => {}

    try {
      render(<AnchoredPanelHarness />)
      const panel = document.querySelector('[data-workspace-panel-key="views-harness"]') as HTMLElement
      await waitFor(() => expect(panel).toHaveStyle({ visibility: 'visible' }))
      const callsAfterInitialPosition = rectSpy.mock.calls.length

      panel.dispatchEvent(new Event('scroll', { bubbles: false }))
      expect(rectSpy.mock.calls.length).toBe(callsAfterInitialPosition)

      window.dispatchEvent(new Event('scroll'))
      expect(rectSpy.mock.calls.length).toBeGreaterThan(callsAfterInitialPosition)
    } finally {
      rectSpy.mockRestore()
      if (originalResizeObserver) vi.stubGlobal('ResizeObserver', originalResizeObserver)
      else vi.unstubAllGlobals()
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })

  it('keeps the same mounted panel node across ordinary rerenders', () => {
    const { rerender } = render(<AnchoredPanelHarness label="Before" />)
    const before = document.querySelector('[data-workspace-panel-key="views-harness"]')
    expect(before).not.toBeNull()

    rerender(<AnchoredPanelHarness label="After" />)

    const after = document.querySelector('[data-workspace-panel-key="views-harness"]')
    expect(after).toBe(before)
    expect(after).toHaveAttribute('data-workspace-panel', 'true')
    expect(screen.getByText('After')).toBeInTheDocument()
  })

  it('blocks outside click and Escape dismissal while an editor transaction owns the panel', () => {
    const { rerender } = render(<DismissLockHarness locked />)

    fireEvent.click(screen.getByTestId('dismiss-outside'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('dismiss-state')).toHaveTextContent('open')

    rerender(<DismissLockHarness locked={false} />)
    fireEvent.click(screen.getByTestId('dismiss-outside'))
    expect(screen.getByTestId('dismiss-state')).toHaveTextContent('closed')
  })
})
