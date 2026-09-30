import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppDropdown } from './AppDropdown'

vi.mock('./OperationalWorkspace', () => ({
  OPERATIONAL_WORKSPACE_VISUALS: {
    fieldLabelText: 'field-label',
    controlSurface: 'control-surface',
  },
}))

vi.mock('./OperationalWorkspacePrimitives', () => ({
  getWorkspaceFloatingPanelClass: () => 'floating-panel',
  useWorkspaceAnchoredLayer: () => ({
    triggerRef: { current: null },
    panelRef: { current: null },
    panelStyle: { top: '0px', left: '0px' },
  }),
}))

describe('AppDropdown', () => {
  it('deduplicates options and supports search and single selection', () => {
    const onChange = vi.fn()
    render(
      <AppDropdown
        value=""
        onChange={onChange}
        placeholder="Choose one"
        options={[
          { value: 'alpha', label: 'Alpha' },
          { value: 'alpha', label: 'Alpha Duplicate' },
          { value: 'beta', label: 'Beta' },
        ]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /choose one/i }))
    const textbox = screen.getByPlaceholderText('Search options...')
    fireEvent.change(textbox, { target: { value: 'beta' } })

    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /beta/i }))

    expect(onChange).toHaveBeenCalledWith('beta')
    expect(screen.queryByPlaceholderText('Search options...')).not.toBeInTheDocument()
  })

  it('supports multi-select labels and empty search states', () => {
    const onChange = vi.fn()
    render(
      <AppDropdown
        value={['alpha']}
        onChange={onChange}
        multi
        options={[
          { value: 'alpha', label: 'Alpha' },
          { value: 'beta', label: 'Beta' },
          { value: 'gamma', label: 'Gamma' },
        ]}
      />
    )

    expect(screen.getByRole('button', { name: /alpha/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /alpha/i }))

    const panel = screen.getByPlaceholderText('Search options...').closest('[data-workspace-panel="true"]')
    expect(panel).not.toBeNull()
    fireEvent.click(within(panel as HTMLElement).getByRole('button', { name: /beta/i }))
    expect(onChange).toHaveBeenCalledWith(['alpha', 'beta'])

    fireEvent.change(screen.getByPlaceholderText('Search options...'), { target: { value: 'zzz' } })
    expect(screen.getByText('No matching options')).toBeInTheDocument()
  })

  it('supports deselection, summary labels, and outside-click closing', () => {
    const onChange = vi.fn()
    render(
      <div>
        <button type="button">outside</button>
        <AppDropdown
          value={['alpha', 'beta']}
          onChange={onChange}
          multi
          options={[
            { value: 'alpha', label: 'Alpha' },
            { value: 'beta', label: 'Beta' },
            { value: 'gamma', label: 'Gamma' },
          ]}
        />
      </div>
    )

    expect(screen.getByRole('button', { name: /2 selected/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /2 selected/i }))

    const panel = screen.getByPlaceholderText('Search options...').closest('[data-workspace-panel="true"]')
    expect(panel).not.toBeNull()
    fireEvent.mouseDown(panel as HTMLElement)
    expect(screen.getByPlaceholderText('Search options...')).toBeInTheDocument()

    fireEvent.click(within(panel as HTMLElement).getByRole('button', { name: /beta/i }))
    expect(onChange).toHaveBeenCalledWith(['alpha'])

    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByPlaceholderText('Search options...')).not.toBeInTheDocument()
  })

  it('closes for an unrelated portaled panel instead of treating every popup as its child', () => {
    const onChange = vi.fn()
    render(
      <AppDropdown
        value="orphan"
        onChange={onChange}
        options={[{ value: 'alpha', label: 'Alpha' }]}
      />
    )

    expect(screen.getByRole('button', { name: /select/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /select/i }))

    const floatingPanel = document.createElement('div')
    floatingPanel.setAttribute('data-workspace-panel', 'true')
    const floatingChild = document.createElement('span')
    floatingPanel.appendChild(floatingChild)
    document.body.appendChild(floatingPanel)

    fireEvent.mouseDown(floatingChild)
    expect(screen.queryByPlaceholderText('Search options...')).not.toBeInTheDocument()

    document.body.removeChild(floatingPanel)
  })

  it('stays inert while disabled', () => {
    const onChange = vi.fn()
    render(
      <AppDropdown
        value=""
        onChange={onChange}
        disabled
        placeholder="Disabled"
        options={[{ value: 'alpha', label: 'Alpha' }]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /disabled/i }))
    expect(screen.queryByPlaceholderText('Search options...')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders inline error and hint states with unique aria ids', () => {
    render(
      <>
        <AppDropdown
          label="Primary"
          value=""
          onChange={() => {}}
          options={[{ value: 'alpha', label: 'Alpha' }]}
          error="Primary is required"
        />
        <AppDropdown
          label="Secondary"
          value=""
          onChange={() => {}}
          options={[{ value: 'beta', label: 'Beta' }]}
          hint="Optional selection"
        />
      </>
    )

    const [primary, secondary] = screen.getAllByRole('button', { name: /select/i })
    const error = screen.getByText('Primary is required')
    const hint = screen.getByText('Optional selection')

    expect(primary).toHaveAttribute('aria-invalid', 'true')
    expect(primary).toHaveAttribute('aria-describedby', error.parentElement?.id || '')
    expect(secondary).toHaveAttribute('aria-invalid', 'false')
    expect(secondary).toHaveAttribute('aria-describedby', hint.parentElement?.id || '')
    expect(error.parentElement?.id).not.toBe(hint.parentElement?.id)
  })
})
