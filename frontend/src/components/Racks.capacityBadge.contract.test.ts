import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/Racks.tsx'), 'utf8')
const miniBar = source.slice(source.indexOf('const MiniBar ='), source.indexOf('// ─── PDU Bar'))
const capacityHeader = source.slice(source.indexOf('/* Capacity bars */'), source.indexOf('/* Elevation grid'))

describe('Rack capacity overflow label layout', () => {
  it('keeps the overflow status, concise measure label, and measured value fully visible', () => {
    expect(miniBar).toContain('flex min-w-0 items-center gap-1')
    expect(miniBar).toContain('whitespace-nowrap" title={label}')
    expect(miniBar).not.toContain('min-w-0 truncate" title={label}')
    expect(miniBar).toContain('inline-flex shrink-0 whitespace-nowrap')
    expect(miniBar).toContain('shrink-0 whitespace-nowrap text-[11px]')
    expect(capacityHeader).toContain('label="Estimate"')
    expect(capacityHeader).not.toContain('label="Typical estimate"')
  })

  it('keeps the configured capacity label visible without a duplicate fill percentage competing for the row', () => {
    expect(capacityHeader).toContain('{effectivePowerCapKw.toFixed(1)}kW')
    expect(capacityHeader).toContain('aria-label={`Configured power capacity: ${effectivePowerCapKw.toFixed(1)} kilowatts`}')
    expect(capacityHeader).not.toContain('% slot')
  })
})
