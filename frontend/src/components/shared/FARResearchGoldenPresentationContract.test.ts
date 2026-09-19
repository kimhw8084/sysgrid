import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const componentsRoot = path.resolve(process.cwd(), 'src/components')
const read = (fileName: string) => fs.readFileSync(path.join(componentsRoot, fileName), 'utf8')

describe('FAR and Research golden presentation contract', () => {
  it('keeps primary tables on the full golden surface without header-count displacement', () => {
    const far = read('FAR.tsx')
    const farControls = read('FARGoldenWorkspaceControls.tsx')
    const farInteraction = read('FARGoldenWorkspaceInteraction.tsx')
    const research = read('Research.tsx')

    expect(far).not.toContain('failure vectors in scope')
    expect(research).not.toContain('mixed records')
    expect(far).not.toContain('surfaceVariant="attached-panel"')
    expect(farControls).toContain('title="Export CSV"')
    expect(farControls.toLowerCase()).toContain('title="copy to clipboard"')
    expect(farInteraction).toContain('<OperationalDataGrid')
    expect(research).toContain('<OperationalDataGrid')
  })

  it('keeps optional FAR display/insight panels opt-in and the filter surface canonical', () => {
    const far = read('FAR.tsx')
    const farControls = read('FARGoldenWorkspaceControls.tsx')
    const research = read('Research.tsx')

    for (const source of [far, research]) {
      expect(source).toContain('const [showStyleLab, setShowStyleLab] = useState(false)')
      expect(source).toContain('const [showInsights, setShowInsights] = useState(false)')
    }
    expect(farControls).toContain('<Sliders size={14} /> Display')
    expect(farControls).toContain('Reliability insights')
    expect(research).toContain('<Sliders size={14} /> Display')
    expect(research).toContain('<Activity size={14} /> Insights')
    expect(far).toContain('const [showFilterBar, setShowFilterBar] = useState(true)')
    expect(research).toContain('const [showYearFilters, setShowYearFilters] = useState(false)')
  })

  it('fails closed when Research list endpoints return errors or non-list payloads', () => {
    const research = read('Research.tsx')

    expect(research).toContain('if (!response.ok) throw new Error(await response.text())')
    expect(research).toContain('if (!Array.isArray(payload)) throw new Error(`Expected a list response from ${path}`)')
    expect(research).toContain("queryFn: () => fetchResearchList('/api/v1/investigations')")
    expect(research).toContain("queryFn: () => fetchResearchList('/api/v1/rca')")
    expect(research).toContain('const combinedUnavailable = combinedData.length === 0 && (investigationsError || rcaError)')
  })
})
