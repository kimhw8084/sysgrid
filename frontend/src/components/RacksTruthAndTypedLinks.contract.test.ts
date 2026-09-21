import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const frontendRoot = path.resolve(__dirname, '..')
const readSource = (relativePath: string) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8')

describe('Racks truthful capacity and typed relationship boundary', () => {
  it('preserves the specialized spatial/planning workspace while using the shared typed owner', () => {
    const source = readSource('components/Racks.tsx')

    expect(source).toContain("from './shared/OperationalObjectReference'")
    expect(source).toContain("resolveOperationalObjectReference('device', device.id)")
    expect(source).toContain("resolveOperationalAuditNavigation('rack', rack.id)")
    expect(source).toContain('useSearchParams')
    expect(source).toContain("searchParams.get('id')")
    expect(source).toContain('allRacks.find((rack: any) => String(rack.id) === requestedRackId)')
    expect(source).toContain('setActiveTab(authoritativeRack.is_deleted ? \'deleted\' : \'active\')')
    expect(source).toContain('Ghost Planner')
    expect(source).toContain('Time Machine')
    expect(source).toContain('Spatial')
    expect(source).toContain('ConnectionLines')
  })

  it('does not claim measured PDU load or live power status', () => {
    const source = readSource('components/Racks.tsx')

    expect(source).not.toContain('Power Consumption')
    expect(source).not.toContain('Power Load')
    expect(source).not.toContain('NOMINAL')
    expect(source).not.toContain('OVERLOADED')
    expect(source).not.toContain('w-[68%]')
    expect(source).toContain('Typical Power Estimate')
    expect(source).toContain('Configured Rack Ceiling')
    expect(source).toContain('Live PDU load telemetry unavailable')
    expect(source).toContain('PLANNING ESTIMATE > CONFIGURED CEILING')
  })

})
