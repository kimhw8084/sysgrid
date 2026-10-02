import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ServiceForm } from './ServiceRegistry'

describe('ServiceForm host selector parity', () => {
  const accessibleFields = [
    ['name', /^Name/], ['installation_date', 'Deployment Date'], ['version', 'Version'], ['purpose', 'Purpose'],
    ['expiry_date', 'Expiry Date'], ['manufacturer', 'Manufacturer'], ['supplier', 'Supplier'], ['cost', 'Cost'],
  ] as const

  it('associates every scalar label and server error with its control', () => {
    const errors = Object.fromEntries(accessibleFields.map(([field]) => [field, `Correct ${field}`]))
    render(<ServiceForm initialData={{}} options={[]} devices={[]} onSave={vi.fn()} backendFieldErrors={errors} />)
    for (const [field, label] of accessibleFields) {
      const control = screen.getByLabelText(label)
      expect(control).toHaveAttribute('aria-invalid', 'true')
      expect(control).toHaveAccessibleDescription(`Correct ${field}`)
      const describedBy = control.getAttribute('aria-describedby')!
      expect(document.getElementById(describedBy)).toHaveTextContent(`Correct ${field}`)
    }
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute('aria-required', 'true')
  })

  it('gives multiple service editors distinct control and error identities', () => {
    const { container } = render(<>
      <ServiceForm initialData={{}} options={[]} devices={[]} onSave={vi.fn()} backendFieldErrors={{ name: 'First editor error' }} />
      <ServiceForm initialData={{}} options={[]} devices={[]} onSave={vi.fn()} backendFieldErrors={{ name: 'Second editor error' }} />
    </>)
    const forms = Array.from(container.querySelectorAll('form'))
    const controls = forms.flatMap(form => accessibleFields.map(([, label]) => within(form).getByLabelText(label)))
    expect(new Set(controls.map(control => control.id)).size).toBe(16)
    expect(within(forms[0]).getByLabelText(/^Name/)).toHaveAccessibleDescription('First editor error')
    expect(within(forms[1]).getByLabelText(/^Name/)).toHaveAccessibleDescription('Second editor error')
  })

  it('clears the invalid name state and description when the user corrects it', () => {
    const onSave = vi.fn()
    const { container } = render(<ServiceForm initialData={{ device_id: 11 }} options={[]}
      devices={[{ id: 11, name: 'Host' }]} onSave={onSave} />)
    fireEvent.submit(container.querySelector('form')!)
    const name = screen.getByLabelText(/^Name/)
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Name is required.')
    fireEvent.change(name, { target: { value: 'Corrected service' } })
    expect(name).toHaveAttribute('aria-invalid', 'false')
    expect(name).not.toHaveAttribute('aria-describedby')
    fireEvent.submit(container.querySelector('form')!)
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Corrected service' }))
  })

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
