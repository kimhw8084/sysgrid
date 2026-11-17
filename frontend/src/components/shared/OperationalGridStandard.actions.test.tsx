import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  createOperationalIdentityColumnDefinition,
  createOperationalPlainValueColumn,
  OperationalGridTextValue,
  renderOperationalActionButtons,
  renderOperationalRowActions,
} from './OperationalGridStandard'

it('keeps the original commands and supplies a full, safely rendered record identity', () => {
  const open = vi.fn()
  const label = 'Primary <database> & service'
  const { container } = render(renderOperationalRowActions(<button onClick={open}>Open details</button>, label))
  expect(screen.getByTitle(label)).toHaveTextContent(label)
  expect(container.querySelector('database')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open details' }))
  expect(open).toHaveBeenCalledOnce()
})

it('keeps standard row-action spacing by default and permits a compact grid-specific gap', () => {
  const { container } = render(<>
    {renderOperationalActionButtons(<button>Standard</button>)}
    {renderOperationalActionButtons(<button>Compact</button>, 'gap-0.5')}
  </>)
  const groups = Array.from(container.querySelectorAll('.flex.items-center.justify-center'))

  expect(groups).toHaveLength(2)
  expect(groups[0]).toHaveClass('gap-1.5')
  expect(groups[1]).toHaveClass('gap-0.5')
})

it('binds full operational cell text to a unique rendered disclosure target', () => {
  const value = 'PW-ASSET-A-1794688342982-d0pck8'
  const identity = createOperationalIdentityColumnDefinition({ field: 'name', headerName: 'Instance' })
  const plain = createOperationalPlainValueColumn({ field: 'system', headerName: 'System' })
  const { container, rerender } = render(<>{identity.cellRenderer({ value })}{plain.cellRenderer({ value })}</>)
  const values = container.querySelectorAll('span[title]')

  expect(values).toHaveLength(2)
  expect(values[0]).toHaveTextContent(value)
  expect(values[1]).toHaveTextContent(value)
  expect(values[0]).toHaveAttribute('title', value)
  expect(values[1]).toHaveAttribute('title', value)
  expect(values[0].id).not.toBe('')
  expect(values[1].id).not.toBe('')
  expect(values[0].id).not.toBe(values[1].id)

  rerender(<>{identity.cellRenderer({ value: 'Different asset' })}{plain.cellRenderer({ value: 'Different system' })}</>)
  const updatedValues = container.querySelectorAll('span[title]')
  expect(updatedValues[0].id).toBe(values[0].id)
  expect(updatedValues[0]).toHaveTextContent('Different asset')
  expect(updatedValues[1]).toHaveTextContent('Different system')
  expect(updatedValues[0]).toHaveAttribute('title', 'Different asset')
  expect(updatedValues[1]).toHaveAttribute('title', 'Different system')
})


it('adds the complete clipped value to the keyboard grid cell name without replacing its column heading', () => {
  const value = 'PW-ASSET-A-1794688342982-d0pck8'
  const tree = (cellValue: string, showValue = true) => (
    <>
      <span id="asset-column-heading">Asset Tag</span>
      <div role="grid" tabIndex={0}>
        <div role="row">
          <div role="gridcell" aria-labelledby="asset-column-heading" tabIndex={-1}>
            {showValue ? <OperationalGridTextValue value={cellValue} className="truncate" /> : null}
          </div>
        </div>
      </div>
    </>
  )
  const { container, rerender } = render(tree(value))
  const cell = container.querySelector('[role="gridcell"]')!
  const text = container.querySelector('span[title]')!
  const nameRefs = (cell.getAttribute('aria-labelledby') || '').split(/\s+/)

  expect(nameRefs).toContain('asset-column-heading')
  expect(nameRefs).toContain(text.id)
  expect(text).toHaveTextContent(value)
  expect(text).toHaveAttribute('title', value)

  rerender(tree('PW-ASSET-B-1794688342982-d0pck8'))
  expect(cell.getAttribute('aria-labelledby')).toBe(`asset-column-heading ${text.id}`)
  expect(text).toHaveTextContent('PW-ASSET-B-1794688342982-d0pck8')

  rerender(tree('', false))
  expect(cell.getAttribute('aria-labelledby')).toBe('asset-column-heading')
})


it('appends a complete grid value to an existing cell label and restores it when virtualized out', () => {
  const tree = (showValue: boolean) => (
    <div role="grid" tabIndex={0}>
      <div role="row">
        <div role="gridcell" aria-label="Make, row 1" tabIndex={-1}>
          {showValue ? <OperationalGridTextValue value="Example Manufacturer" className="truncate" /> : null}
        </div>
      </div>
    </div>
  )
  const { container, rerender } = render(tree(true))
  const cell = container.querySelector('[role="gridcell"]')!
  expect(cell).toHaveAttribute('aria-label', 'Make, row 1: Example Manufacturer')

  rerender(tree(false))
  expect(cell).toHaveAttribute('aria-label', 'Make, row 1')
})
