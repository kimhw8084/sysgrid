import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { renderOperationalRowActions } from './OperationalGridStandard'

it('keeps the original commands and supplies a full, safely rendered record identity', () => {
  const open = vi.fn()
  const label = 'Primary <database> & service'
  const { container } = render(renderOperationalRowActions(<button onClick={open}>Open details</button>, label))
  expect(screen.getByTitle(label)).toHaveTextContent(label)
  expect(container.querySelector('database')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open details' }))
  expect(open).toHaveBeenCalledOnce()
})
