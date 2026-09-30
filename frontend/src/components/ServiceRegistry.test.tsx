import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ServiceForm } from './ServiceRegistry'

describe('ServiceForm host selector parity', () => {
  it('blocks form submission while saving and permits retry with the same draft', () => {
    const props = {
      initialData: { name: 'Payments DB', service_type: 'Database', status: 'Active', environment: 'Production', device_id: 11, config_json: {} },
      onSave: vi.fn(), options: [], devices: [{ id: 11, name: 'DB-PRIMARY', system: 'CORE', type: 'Physical' }],
    }
    const { container, rerender } = render(<ServiceForm {...props} isPending={true} />)
    fireEvent.submit(container.querySelector('form')!)
    fireEvent.submit(container.querySelector('form')!)
    expect(props.onSave).not.toHaveBeenCalled()
    rerender(<ServiceForm {...props} isPending={false} />)
    fireEvent.submit(container.querySelector('form')!)
    expect(props.onSave).toHaveBeenCalledTimes(1)
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Payments DB', device_id: 11 }))
  })

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
