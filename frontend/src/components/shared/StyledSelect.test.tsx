import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StyledSelect } from './StyledSelect'

describe('StyledSelect', () => {
  it('renders inline error state with aria wiring', () => {
    render(
      <StyledSelect
        label="Status"
        value=""
        onChange={() => {}}
        options={[{ value: 'planned', label: 'Planned' }]}
        error="Status is required"
      />
    )

    const select = screen.getByRole('combobox', { name: 'Status' })
    const error = screen.getByText('Status is required')

    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAttribute('aria-describedby', error.getAttribute('id') || '')
  })

  it('renders hint text when there is no error', () => {
    render(
      <StyledSelect
        label="Environment"
        value=""
        onChange={() => {}}
        options={[{ value: 'prod', label: 'Production' }]}
        hint="Choose the deployment target."
      />
    )

    const select = screen.getByRole('combobox', { name: 'Environment' })
    const hint = screen.getByText('Choose the deployment target.')

    expect(select).toHaveAttribute('aria-invalid', 'false')
    expect(select).toHaveAttribute('aria-describedby', hint.getAttribute('id') || '')
  })
})
