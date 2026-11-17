import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import AssetGoldenShellScaffold from './AssetGoldenShellScaffold'

const createProps = (viewMode: 'grid' | 'report' | 'map') => ({
  activeTab: 'inventory' as const,
  existingCount: 12,
  purgedCount: 3,
  onTabChange: vi.fn(),
  searchTerm: '',
  onSearchTermChange: vi.fn(),
  toolbarControls: null,
  toolbarActions: null,
  filterChips: [],
  children: <div>Asset view</div>,
  viewMode,
  onViewModeChange: vi.fn(),
})

describe('asset header view controls', () => {
  it('keeps registry scope first and view surface rightmost across all surfaces', () => {
    const { container, rerender } = render(<AssetGoldenShellScaffold {...createProps('grid')} />)

    for (const viewMode of ['grid', 'report', 'map'] as const) {
      rerender(<AssetGoldenShellScaffold {...createProps(viewMode)} />)
      const switches = Array.from(container.querySelectorAll('[data-slot="scope-switch"]'))
      expect(switches).toHaveLength(2)
      expect(switches[0].textContent).toContain('Registry Scope')
      expect(switches[1].textContent).toContain('View Surface')
      expect(switches[0].querySelector('[aria-pressed="true"]')?.textContent).toContain('Existing')
      expect(switches[1].querySelector('[aria-pressed="true"]')?.textContent).toContain(viewMode === 'grid' ? 'Grid' : viewMode === 'report' ? 'Report' : 'Map')
    }
  })
})
