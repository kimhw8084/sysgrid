import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { ToolbarButton, ToolbarSegmented } from './LayoutPrimitives'

describe('ToolbarButton', () => {
  it('keeps the shared inline layout contract', () => {
    render(<ToolbarButton>Save</ToolbarButton>)

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.className).toContain('inline-flex')
    expect(button.className).toContain('items-center')
    expect(button.className).toContain('gap-2')
    expect(button.className).toContain('whitespace-nowrap')
    expect(button.className).toContain('shrink-0')
  })
})

describe('ToolbarSegmented', () => {
  it('keeps every option keyboard operable and exposes the selected state', async () => {
    const user = userEvent.setup()
    const options = [
      { label: 'Parameters', value: 'parameters' },
      { label: 'Permissions', value: 'permissions' },
      { label: 'Metadata', value: 'metadata' },
      { label: 'Analysis', value: 'analysis' },
    ]

    const Harness = () => {
      const [value, setValue] = useState('parameters')
      return <ToolbarSegmented options={options} value={value} onChange={setValue} />
    }

    render(<Harness />)
    const group = screen.getByRole('group', { name: 'View selection' })
    const scrollArea = group.parentElement
    const parameters = screen.getByRole('button', { name: 'Parameters' })
    const metadata = screen.getByRole('button', { name: 'Metadata' })

    expect(scrollArea?.className).toContain('overflow-x-auto')
    expect(parameters).toHaveAttribute('aria-pressed', 'true')
    expect(metadata).toHaveAttribute('aria-pressed', 'false')

    await user.tab()
    expect(parameters).toHaveFocus()
    await user.tab()
    await user.tab()
    expect(metadata).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(metadata).toHaveAttribute('aria-pressed', 'true')
  })
})
