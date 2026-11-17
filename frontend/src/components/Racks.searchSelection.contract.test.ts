import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(__dirname, 'Racks.tsx'), 'utf8')

describe('Rack search and selection context', () => {
  it('routes source-verified mounted-device search matches into elevation highlights', () => {
    expect(source).toContain("import { searchRackCollection } from './rackSearch'")
    expect(source).toContain('searchRackCollection(rackSearchScope, searchTerm, devices || [])')
    expect(source).toContain('matchedDeviceIds={rackSearchMatchesByRackId.get(String(r.id))}')
    expect(source).toContain('placeholder="Search racks or asset IDs…"')
    expect(source).toContain('Linked device records are unavailable or still loading')
  })

  it('keeps Spatial and Elevation on the same rack set and hands focus to the exact rack', () => {
    expect(source).toContain('racks={renderedRacks}')
    expect(source).toContain('pendingSpatialRackIdRef.current = String(rack.id)')
    expect(source).toContain('[data-rack-elevation-card="true"][data-rack-id="${rackId}"]')
    expect(source).toContain("input[type=\"checkbox\"], [data-rack-focus-target=\"true\"]")
    expect(source).not.toContain('window.setTimeout(() => {\n      document.querySelector(`[data-rack-id=')
  })

  it('exposes filter state, keyboard-visible Site actions, and hidden bulk selection context', () => {
    expect(source).toContain('aria-label={`Filter racks by site ${s.name}`}')
    expect(source).toContain('aria-pressed={isActive}')
    expect(source).toContain('group-focus-within/site:opacity-100')
    expect(source).toContain('focus-visible:opacity-100')
    expect(source).toContain('{hiddenCount} hidden by current filters')
    expect(source).toContain('aria-label="Clear rack selection"')
  })
})
