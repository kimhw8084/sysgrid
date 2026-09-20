import { fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { OperationalAssetSelector } from './OperationalAssetSelector'

const assets = [
  { id: 11, name: 'DB-PRIMARY', system: 'CORE', type: 'Physical' },
  { id: 22, name: 'APP-STAGE', system: 'STAGE', type: 'Virtual' },
]

describe('OperationalAssetSelector', () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame
  const originalCancelAnimationFrame = window.cancelAnimationFrame

  beforeAll(() => {
    window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)
    window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle)
  })

  afterAll(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
  })

  it('filters by system and search, then returns the selected numeric id or null', async () => {
    const onChange = vi.fn()
    render(
      <OperationalAssetSelector
        label="Registry Asset"
        assets={assets}
        value={null}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Select asset' }))
    fireEvent.click(await screen.findByRole('button', { name: 'All Systems' }))
    fireEvent.click(await screen.findByRole('button', { name: /^STAGE$/ }))

    expect(screen.getByText('APP-STAGE', { exact: true })).toBeInTheDocument()
    expect(screen.queryByText('DB-PRIMARY', { exact: true })).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search hostname or system...'), { target: { value: 'app-' } })
    fireEvent.click(await screen.findByRole('button', { name: /APP-STAGE/ }))
    expect(onChange).toHaveBeenCalledWith(22)

    fireEvent.click(screen.getByRole('button', { name: 'Select asset' }))
    fireEvent.click(await screen.findByRole('button', { name: 'No linked asset' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('preserves required/error presentation and closes deterministically outside the anchored panel', async () => {
    const onChange = vi.fn()
    render(
      <div>
        <button type="button">Outside</button>
        <OperationalAssetSelector
          label="Host"
          required
          assets={assets}
          value={null}
          onChange={onChange}
          error="Host is required."
        />
      </div>
    )

    expect(screen.getByText('Host')).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByText('Host is required.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select asset' }))
    expect(await screen.findByPlaceholderText('Search hostname or system...')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByPlaceholderText('Search hostname or system...')).not.toBeInTheDocument()
  })
})
