import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

const views = [
  'MonitoringGrid.tsx',
  'assets/AssetGoldenOperationalWorkspace.tsx',
  'ServicesReal.tsx',
  'External.tsx',
  'NetworkReal.tsx',
  'FAR.tsx',
  'Research.tsx',
  'vendors/VendorGoldenOperationalWorkspace.tsx',
] as const

describe('Golden workspace geometry contract', () => {
  it('locks the accepted frame, toolbar, and grid geometry in shared owners', () => {
    const shell = read('shared/OperationalWorkspaceShells.tsx')
    const layout = read('shared/LayoutPrimitives.tsx')
    const commandBar = read('shared/WorkspaceCommandBar.tsx')

    expect(shell).toContain("GOLDEN_WORKSPACE_GEOMETRY_VERSION = '1'")
    expect(shell).toContain("GOLDEN_WORKSPACE_FRAME_CLASS = 'h-full min-h-0 flex flex-col space-y-4'")
    expect(shell).toContain("golden: 'rounded-lg'")
    expect(shell).toContain("'attached-panel': 'rounded-t-none border-x border-b border-white/5'")
    expect(shell).toContain('data-golden-geometry-version={GOLDEN_WORKSPACE_GEOMETRY_VERSION}')

    expect(layout).toContain("GOLDEN_PAGE_HEADER_CLASS = 'flex flex-wrap items-start justify-between gap-6'")
    expect(layout).toContain("GOLDEN_PAGE_TOOLBAR_CLASS = 'flex items-center gap-3 overflow-x-auto rounded-lg border border-white/5 bg-black/20 px-4 py-3 backdrop-blur-xl lg:flex-wrap lg:justify-between lg:overflow-visible'")
    expect(layout).toContain('data-golden-page-header="true"')
    expect(layout).toContain('data-golden-page-toolbar="true"')

    expect(commandBar).toContain("GOLDEN_COMMAND_BAR_STACK_CLASS = 'space-y-4'")
    expect(commandBar).toContain("GOLDEN_COMMAND_BAR_SECONDARY_CLASS = 'px-4 py-3'")
    expect(commandBar).toContain("GOLDEN_FILTER_CHIP_ROW_CLASS = 'flex flex-wrap items-center gap-2'")
    expect(commandBar).toContain('data-golden-command-bar="true"')
  })

  it.each(views)('%s cannot locally reconstruct fundamental shell geometry', (file) => {
    const source = read(file)
    expect(source).not.toContain('h-full min-h-0 flex flex-col space-y-4')
    expect(source).not.toContain('flex flex-wrap items-start justify-between gap-6')
    expect(source).not.toContain('overflow-x-auto rounded-lg border border-white/5 bg-black/20 px-4 py-3')
    expect(source).not.toContain('rounded-t-none border-x border-b border-white/5')
  })

  it('follows the live Assets route chain instead of the retired AssetReal filename', () => {
    const assets = read('Assets.tsx')
    const route = read('assets/AssetGoldenShellRoute.tsx')
    const workspace = read('assets/AssetGoldenOperationalWorkspace.tsx')
    const app = fs.readFileSync(path.resolve(root, '..', 'App.tsx'), 'utf8')
    expect(assets).toContain("AssetGoldenShellRoute")
    expect(route).toContain("AssetGoldenOperationalWorkspace")
    expect(workspace).toContain("AssetGoldenShellScaffold")
    expect(app).toContain('path="/asset"')
    expect(app).toContain('<Assets />')
  })
})
