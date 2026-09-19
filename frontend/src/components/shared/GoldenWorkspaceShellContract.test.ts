import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
// SYSGRID_ALLOW_SOURCE_OWNERSHIP_ASSERTION — textual ownership is the contract under test.

const root = path.resolve(__dirname, '..')
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

const views = [
  ['MonitoringGrid.tsx', 'table'],
  ['assets/AssetGoldenShellScaffold.tsx', 'table'],
  ['ServicesReal.tsx', 'table'],
  ['External.tsx', 'table'],
  ['NetworkReal.tsx', 'hybrid'],
  ['ProjectsGolden.tsx', 'hybrid'],
  ['FAR.tsx', 'analytical'],
  ['Research.tsx', 'analytical'],
  ['vendors/VendorGoldenOperationalWorkspace.tsx', 'table'],
] as const

describe('Golden workspace shell contract', () => {
  it('seals the shared shell and grid with machine-readable ownership markers', () => {
    const shell = read('shared/OperationalWorkspaceShells.tsx')
    expect(shell).toContain('data-golden-workspace-shell="true"')
    expect(shell).toContain('data-golden-archetype={archetype}')
    expect(shell).toContain('data-golden-grid-surface="true"')
    expect(shell).toContain("variant?: 'golden' | 'attached-panel'")
  })

  it.each(views)('%s declares the approved archetype and avoids local golden-grid reconstruction', (file, archetype) => {
    const source = read(file)
    if (file === 'assets/AssetGoldenShellScaffold.tsx') {
      expect(source).toContain('<OperationalWorkspaceShell')
    } else {
      expect(source).toContain(`archetype="${archetype}"`)
    }
    expect(source).not.toContain('className="monitoring-grid-shell monitoring-grid')
    expect(source).not.toContain('AgGridReact')
  })

  it('locks the live Assets route to the golden shell scaffold and workspace owner', () => {
    const route = read('assets/AssetGoldenShellRoute.tsx')
    const workspace = read('assets/AssetGoldenOperationalWorkspace.tsx')
    const scaffold = read('assets/AssetGoldenShellScaffold.tsx')
    expect(route).toContain('AssetGoldenOperationalWorkspace')
    expect(workspace).toContain('AssetGoldenShellScaffold')
    expect(scaffold).toContain('OperationalWorkspaceShell')
  })

  it('permits attached-panel geometry only through the shared named variant', () => {
    const far = read('FAR.tsx')
    expect(far).not.toContain('surfaceVariant="attached-panel"')
    expect(far).not.toContain('rounded-t-none border-x border-b border-white/5')
  })
})
