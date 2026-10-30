import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (relativePath: string) =>
  readFileSync(path.resolve(process.cwd(), 'src/components', relativePath), 'utf8')

const rootSource = (relativePath: string) =>
  readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')

const expectAll = (text: string, fragments: string[]) => {
  for (const fragment of fragments) expect(text, `missing source contract: ${fragment}`).toContain(fragment)
}

const farSource = source('FAR.tsx')
const monitoringSource = source('MonitoringGrid.tsx')
const shellSource = source('shared/OperationalWorkspaceShells.tsx')
const controlsSource = source('FARGoldenWorkspaceControls.tsx')
const interactionSource = source('FARGoldenWorkspaceInteraction.tsx')
const standardGridSource = source('shared/OperationalGridStandard.tsx')
const dataGridSource = source('shared/OperationalDataGrid.tsx')
const dataStateSource = source('FAR.deepLink.ts')
const collaborativeSource = source('shared/CollaborativeWorkspaceViews.ts')
const modalShellSource = source('shared/WorkspaceModalShells.tsx')
const primitivesSource = source('shared/OperationalWorkspacePrimitives.tsx')
const goldenColumnsSource = source('shared/OperationalGoldenColumns.tsx')
const farGridColumnsSource = source('FAR.gridColumns.tsx')
const bulkPreviewSource = source('shared/OperationalBulkPreviewModal.tsx')
const appCssSource = rootSource('src/index.css')

export const PC51_FINAL_INDEX_ROWS = [
  'G01', 'G47', 'G51', 'G52', 'G55', 'G56', 'G59', 'G60', 'G61',
  'G71', 'G72', 'G73', 'G76', 'G77', 'G80', 'G81', 'G86', 'G94',
  'G96', 'G99', 'G101',
] as const

describe('PC-51 FAR foundational contracts final-index closure', () => {
  it('binds exactly the approved twenty-one canonical closure candidates', () => {
    expect(PC51_FINAL_INDEX_ROWS).toHaveLength(21)
    expect(new Set(PC51_FINAL_INDEX_ROWS).size).toBe(21)
    expect(PC51_FINAL_INDEX_ROWS).toEqual([
      'G01', 'G47', 'G51', 'G52', 'G55', 'G56', 'G59', 'G60', 'G61',
      'G71', 'G72', 'G73', 'G76', 'G77', 'G80', 'G81', 'G86', 'G94',
      'G96', 'G99', 'G101',
    ])
  })

  it('G01 proves FAR and Monitoring share one viewport geometry primitive with no archetype-specific frame branch', () => {
    expectAll(farSource, [
      '<OperationalWorkspaceShell',
      'archetype="analytical"',
      'workspace="far"',
    ])
    expectAll(monitoringSource, [
      '<OperationalWorkspaceShell',
      'archetype="table"',
      'workspace="monitoring"',
    ])
    expectAll(shellSource, [
      "export const GOLDEN_WORKSPACE_GEOMETRY_VERSION = '1'",
      "export const GOLDEN_WORKSPACE_FRAME_CLASS = 'h-full min-h-0 flex flex-col space-y-4'",
      "export const GOLDEN_GRID_BASE_CLASS = 'operational-grid-shell operational-grid flex flex-1 w-full min-h-0 flex-col glass-panel overflow-hidden ag-theme-alpine-dark relative'",
      'className={join(GOLDEN_WORKSPACE_FRAME_CLASS, className)}',
      'data-golden-geometry-version={GOLDEN_WORKSPACE_GEOMETRY_VERSION}',
      '<OperationalWorkspaceFrame header={header} commandBar={resolvedCommandBar} className={className} workspace={workspace} archetype={archetype}>',
    ])
    expect(shellSource).not.toContain("archetype === 'table'")
    expect(shellSource).not.toContain("archetype === 'analytical'")
  })

  it('G47/G51/G52 retain explicit selection, shared right-click context and shared compact action mechanics', () => {
    expectAll(standardGridSource, [
      'checkboxSelection: true',
      'headerCheckboxSelection: true',
      'createOperationalActionColumnDefinition',
      'renderOperationalActionButtons',
    ])
    expectAll(farSource, [
      'createOperationalUtilityColumns(operatorIntelligence.utilityColumnsConfig)',
      'createOperationalActionColumnDefinition({',
      'renderOperationalActionButtons([',
    ])
    expectAll(controlsSource, [
      'const { handleCellContextMenu } = useOperationalContextMenu({',
      'contextMenu: { handleCellContextMenu },',
    ])
    expectAll(interactionSource, [
      "onSelectionChanged={(event) => handleSelectionChanged(event, 'raw')}",
      'selectionScopeKey={selectionScopeKey}',
    ])
  })

  it('G55/G56 preserve single-line truncation, tooltips and dense linked-cell hover/full-value access', () => {
    expectAll(appCssSource, [
      'text-overflow: ellipsis;',
      'white-space: nowrap;',
    ])
    expectAll(goldenColumnsSource, [
      'tooltipField:',
      'title={title}',
      'OperationalLinkedCountCell',
    ])
    expectAll(farSource, [
      "tooltipField: 'system_name'",
      "tooltipField: 'failure_type'",
      "tooltipField: 'title'",
    ])
    expectAll(farGridColumnsSource, [
      "headerName: 'Vectors'",
      '<FarVectorBadge label="C/R"',
      '<FarVectorBadge label="W"',
      '<FarVectorBadge label="M"',
      '<FarVectorBadge label="P"',
      '<OperationalLinkedCountCell',
      'previewTitle="Linked RCA Records"',
    ])
  })

  it('G59/G60/G61 route FAR loading, filtered-empty and query-error states through the shared grid state surface', () => {
    expectAll(interactionSource, [
      '<OperationalDataGrid',
      'loading={loading}',
      'dataState={dataState}',
    ])
    expectAll(dataGridSource, [
      '<OperationalGridSurface',
      'loading={loading}',
      'const shouldRenderEmptyState = Boolean(',
      "dataState.kind !== 'query-error'",
      '<WorkspaceEmptyState',
      'title={dataState.title}',
      'title={dataState?.title || noRowsLabel}',
    ])
    expectAll(dataStateSource, [
      "kind: 'query-error'",
      "title: 'Failure analysis registry unavailable'",
      "kind: 'filtered-empty'",
      "title: lifecycleScope === 'archived' ? 'No archived failure modes' : 'No failure modes in scope'",
      "kind: 'ready'",
    ])
  })

  it('G71/G72/G73 retain the shared collaborative view subsystem, local personal fallback and explicit conflict recovery', () => {
    expectAll(controlsSource, [
      'useCollaborativeWorkspaceViews<FarWorkspaceViewConfig, FarSavedView>({',
      "workspaceKey: 'far'",
      '<OperationalSavedViewsPanel',
      'conflictMessage={collaborativeViews.conflict?.message}',
      'collaborativeViews.reloadConflict()',
      'onSaveConflictCopy={() => { void collaborativeViews.saveConflictCopy() }}',
    ])
    expectAll(collaborativeSource, [
      "export type CollaborativeViewScope = 'personal' | 'team'",
      'localFallbackView',
      "if (scope === 'team')",
      'parseWorkspaceViewConflict',
      'reloadConflict',
      'saveConflictCopy',
    ])
  })

  it('G76/G77 retain the 2-to-5 compare contract on the shared WorkspaceCompareShell', () => {
    expectAll(controlsSource, [
      'const compareItems = useMemo(() => selectedRows(modes, selectedIds), [modes, selectedIds])',
      'const compareEnabled = compareItems.length >= 2 && compareItems.length <= 5',
      'isOpen={compareOpen}',
      '<WorkspaceCompareShell',
    ])
    expectAll(modalShellSource, [
      'export function WorkspaceCompareShell',
    ])
    expectAll(controlsSource, [
      '<WorkspaceModal',
      '<WorkspaceCompareShell',
    ])
  })

  it('G80/G81 keep linked BKM and Research actions behind their owning apps', () => {
    expectAll(farSource, [
      'function BkmGuidanceModal',
      'ModulePolicyButton moduleId="knowledge"',
      'onClick={() => navigate(`/knowledge?id=${res.knowledge_id}`)}',
      'Jump to BKM',
      'ModulePolicyButton moduleId="research"',
      'onClick={() => navigate(`/research?type=research&id=${r.id}`)}',
      'setSelectedRcaDetail(r);',
      '<EnhancedRcaDetails',
      '<BkmGuidanceModal',
      '<ResolutionManagerModal',
    ])
  })

  it('G86 preserves the main authoring editor as a large full-width shared workspace working area', () => {
    expectAll(farSource, [
      'function FARAuthoringModal',
      '<WorkspaceModal',
      'size="workspace"',
      "{ id: 'definition', label: 'Definition'",
      "{ id: 'risk', label: 'Risk'",
      "{ id: 'impact', label: 'Impact'",
    ])
    expectAll(primitivesSource, [
      "export type WorkspaceModalSize = 'compact' | 'standard' | 'wide' | 'workspace' | 'fullscreen'",
      "if (size === 'workspace') return 'p-6 sm:p-10'",
      "if (size === 'workspace') return 'w-full max-w-[1440px] h-full sm:h-auto sm:max-h-[92vh]'",
    ])
  })

  it('G94/G96/G99 retain anchored bulk actions, shared retirement preview and explicit destructive confirmation', () => {
    expectAll(controlsSource, [
      '<OperationalAnchoredPanel',
      'panelKey="bulk-menu"',
      'Retire selected',
    ])
    expectAll(farSource, [
      '<OperationalBulkPreviewModal',
      "? 'Restore failure vectors'",
      ": 'Retire failure vectors'",
      'onConfirm={() => bulkOperationPreview && bulkMutation.mutate({',
    ])
    expectAll(bulkPreviewSource, [
      "previewBasis = 'backend'",
      "? 'Preview uses currently loaded workspace data; the backend remains authoritative when you confirm.'",
      " : 'No records change until you confirm.'",
      'onClick={onConfirm}',
      'ariaLabel={`Confirm ${actionLabel}`}',
      "{isExecuting ? 'Applying…' : `Confirm ${actionLabel}`}",
    ])
  })

  it('G101 keeps rendered FAR dates on shared formatAppDate and rejects bespoke locale formatting', () => {
    expectAll(farSource, [
      "import { formatAppDate } from '../utils/dateUtils'",
      'formatAppDate(',
    ])
    expect(farSource).not.toContain('.toLocaleDateString(')
    expect(farSource).not.toContain('.toLocaleString(')
    expect(farSource).not.toContain('.toLocaleTimeString(')
  })
})
