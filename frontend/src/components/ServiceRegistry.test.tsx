import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ServiceForm } from './ServiceRegistry'

describe('ServiceForm host selector parity', () => {
  it('keeps Host required validation and submits the selected device id as a number', async () => {
    const onSave = vi.fn()
    render(
      <ServiceForm
        initialData={{
          name: 'Payments DB',
          service_type: 'Database',
          status: 'Existing',
          environment: 'Production',
          device_id: null,
          config_json: {},
        }}
        onSave={onSave}
        isPending={false}
        options={[]}
        devices={[
          { id: 11, name: 'DB-PRIMARY', system: 'CORE', type: 'Physical' },
          { id: 22, name: 'APP-STAGE', system: 'STAGE', type: 'Virtual' },
        ]}
      />
    )

    fireEvent.click(screen.getByTestId('service-commit-btn'))
    expect(screen.getByText('Host is required.')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Select host node' }))
    fireEvent.change(screen.getByPlaceholderText('Search hostname or system...'), { target: { value: 'APP-STAGE' } })
    fireEvent.click(await screen.findByRole('button', { name: /APP-STAGE/ }))

    fireEvent.click(screen.getByTestId('service-commit-btn'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ device_id: 22 }))
    expect(typeof onSave.mock.calls[0][0].device_id).toBe('number')
  })
})
