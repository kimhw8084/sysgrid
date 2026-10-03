import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceFlyoutDropdownEditor } from './WorkspaceFlyout'

vi.mock('./OperationalWorkspacePrimitives', () => ({
  getWorkspaceFloatingPanelClass: () => 'floating-panel',
  useWorkspaceAnchoredLayer: () => ({
    triggerRef: { current: null },
    panelRef: { current: null },
    panelStyle: { top: '0px', left: '0px' },
  }),
}))

describe('WorkspaceFlyoutDropdownEditor selection', () => {
  it.each([7, 0, 'active'])('keeps the selected label and applies the string value for option %s', (option) => {
    const apply = vi.fn()
    function Editor() {
      const [value, setValue] = useState('')
      return <WorkspaceFlyoutDropdownEditor value={value} onChange={setValue}
        options={[{ value: option, label: 'Chosen target' }]} placeholder="Choose target"
        actionLabel="Apply target" onApply={() => apply(value)} disabled={value === ''} />
    }
    render(<Editor />)
    expect(screen.getByRole('button', { name: 'Apply target' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Choose target' }))
    fireEvent.click(screen.getByRole('button', { name: 'Chosen target' }))
    expect(screen.getByRole('button', { name: 'Chosen target' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose target' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply target' }))
    expect(apply).toHaveBeenCalledExactlyOnceWith(String(option))
  })
})
