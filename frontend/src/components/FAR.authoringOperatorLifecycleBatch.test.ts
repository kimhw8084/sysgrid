import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildFarAuthoringErrors,
  getFarAuthoringFirstErrorTab,
  getFarAuthoringTabErrorCounts,
  isFarAuthoringFieldRequired,
} from './FAR.authoringModel'
import {
  FAR_FAVORITES_STORAGE_KEY,
  FAR_WATCH_STORAGE_KEY,
  isFarRecentChange,
  normalizeFarPreferenceIds,
  sortFarModesByFavorite,
  toggleFarPreferenceId,
} from './FAR.operatorIntelligence'
import {
  formatFarHistoryValue,
  getFarHistoryRestoreAction,
} from './FAR.versionHistoryContract'
import { getFarLifecycleEndpoint } from './FAR.lifecycleVocabulary'

export const PC49_NEW_CLOSURE_ROWS = [
  'G03',
  'G43', 'G44', 'G45', 'G46', 'G49', 'G50',
  'G75', 'G78', 'G79',
  'G84', 'G85', 'G87', 'G88', 'G89', 'G90', 'G91', 'G92', 'G93',
] as const

export const PC49_REGRESSION_LOCK_ROWS = [
  'G53', 'G74', 'G82', 'G83', 'G97', 'G98', 'G100',
] as const

const components = resolve(process.cwd(), 'src/components')
const farSource = readFileSync(resolve(components, 'FAR.tsx'), 'utf8')
const intelligenceSource = readFileSync(resolve(components, 'FAR.operatorIntelligence.ts'), 'utf8')
const authoringSource = readFileSync(resolve(components, 'FAR.authoringModel.ts'), 'utf8')
const historySource = readFileSync(resolve(components, 'FARVersionHistory.tsx'), 'utf8')
const historyContractSource = readFileSync(resolve(components, 'FAR.versionHistoryContract.ts'), 'utf8')
const workspaceModalSource = readFileSync(resolve(components, 'shared/WorkspaceModal.tsx'), 'utf8')
const workspaceHooksSource = readFileSync(resolve(components, 'shared/OperationalWorkspaceHooks.ts'), 'utf8')

const expectAll = (source: string, fragments: readonly string[]) => {
  for (const fragment of fragments) expect(source, fragment).toContain(fragment)
}

describe('PC-49 FAR authoring + operator intelligence + lifecycle/history exact G batch', () => {
  it('binds exactly nineteen new closure candidates plus seven existing regression locks', () => {
    expect(PC49_NEW_CLOSURE_ROWS).toHaveLength(19)
    expect(PC49_REGRESSION_LOCK_ROWS).toHaveLength(7)
    const batch = [...PC49_NEW_CLOSURE_ROWS, ...PC49_REGRESSION_LOCK_ROWS]
    expect(batch).toHaveLength(26)
    expect(new Set(batch).size).toBe(26)
    expect(PC49_NEW_CLOSURE_ROWS).toEqual([
      'G03',
      'G43', 'G44', 'G45', 'G46', 'G49', 'G50',
      'G75', 'G78', 'G79',
      'G84', 'G85', 'G87', 'G88', 'G89', 'G90', 'G91', 'G92', 'G93',
    ])
    expect(PC49_REGRESSION_LOCK_ROWS).toEqual(['G53', 'G74', 'G82', 'G83', 'G97', 'G98', 'G100'])
  })

  it('G03 exposes authoritative Active / Archived lifecycle scope and restore', () => {
    expectAll(farSource, [
      '/api/v1/far/modes?include_deleted=true',
      "useState<'active' | 'archived'>('active')",
      'HeaderScopeSwitch',
      "lifecycleScope === 'archived'",
      'getFarLifecycleEndpoint(action)',
      "action: 'restore'",
    ])
    expect(getFarLifecycleEndpoint('restore')).toBe('/api/v1/far/modes/bulk-restore')
  })

  it('G43/G44 persist and normalize Favorite/Pin and Watch operator preferences', () => {
    expect(FAR_FAVORITES_STORAGE_KEY).toBe('sysgrid_far_favorites_v1')
    expect(FAR_WATCH_STORAGE_KEY).toBe('sysgrid_far_watch_v1')
    expect(normalizeFarPreferenceIds([3, '3', 2, 0, -1, 'bad'])).toEqual([3, 2])
    expect(toggleFarPreferenceId([2, 3], 2)).toEqual([3])
    expect(toggleFarPreferenceId([2], 4)).toEqual([2, 4])
    expect(sortFarModesByFavorite([{ id: 1 }, { id: 2 }, { id: 3 }], [3, 1]).map((row) => row.id)).toEqual([1, 3, 2])
    expectAll(intelligenceSource, [
      'usePersistentJsonState<number[]>(FAR_FAVORITES_STORAGE_KEY, [])',
      'usePersistentJsonState<number[]>(FAR_WATCH_STORAGE_KEY, [])',
      'includeFavorite: true',
      'includeWatch: true',
      "columns: ['favorite', 'watch']",
    ])
  })

  it('G45/G46 expose Recent Change plus expandable Signals intelligence', () => {
    const changed = '2026-08-27T12:00:00Z'
    const before = Date.parse('2026-08-27T11:00:00Z')
    const after = Date.parse('2026-08-27T13:00:00Z')
    expect(isFarRecentChange({ updated_at: changed }, before)).toBe(true)
    expect(isFarRecentChange({ updated_at: changed }, after)).toBe(false)
    expectAll(intelligenceSource, [
      'includeRecentChange: true',
      'isIntelligenceExpanded',
      'setIsIntelligenceExpanded',
      'FAR_LAST_VISITED_STORAGE_KEY',
    ])
    expectAll(farSource, [
      'operatorIntelligence.isIntelligenceExpanded',
      'operatorIntelligence.setIsIntelligenceExpanded',
      '<Activity size={14} /> Signals',
      'createOperationalUtilityColumns(operatorIntelligence.utilityColumnsConfig)',
    ])
  })

  it('G49/G50 lock pending rows and use the shared row/double-click interaction model', () => {
    expectAll(intelligenceSource, [
      'useOperationalRowInteractions({',
      'onRowDoubleClick: onOpenDetail',
      'pendingIds,',
      'selectionScopeKey,',
      "'row-ghost opacity-40 grayscale pointer-events-none'",
      'beginPending',
      'endPending',
    ])
    expectAll(farSource, [
      'operatorIntelligence.beginPending(ids)',
      'operatorIntelligence.endPending(ids)',
      'rowInteractions={operatorIntelligence.rowInteractions}',
      'getRowClass={operatorIntelligence.getRowClass}',
    ])
  })

  it('G75 protects dirty main FAR authoring work including browser unload and discard confirmation', () => {
    expectAll(farSource, [
      'useOperationalFormDirty(initialDraft, sanitizeFarAuthoringPayload)',
      'isDirty={isDirty && !isArchived}',
      'resolveIsDirty={resolveIsDirty}',
      'dirtyConfirmTitle="Discard FAR changes?"',
      'dirtyConfirmMessage="This failure vector has unsaved authoring changes. Close and discard them?"',
    ])
    expect(workspaceModalSource).toContain('useOperationalDirtyGuard({')
    expect(workspaceHooksSource).toContain('usePageLeaveGuard(effectiveDirty)')
    expectAll(readFileSync(resolve(process.cwd(), 'src/components/shared/workspaceDeparture.ts'), 'utf8'), [
      'BeforeUnloadEvent',
      "window.addEventListener('beforeunload', handleBeforeUnload)",
      "window.removeEventListener('beforeunload', handleBeforeUnload)",
    ])
  })

  it('G78/G79 keep record Version History distinct and expose structured canonical restore/delta semantics', () => {
    expectAll(farSource, [
      "{ id: 'versions', label: 'Version History'",
      "{ id: 'history', label: 'Research History'",
      "activeTab === 'versions' && <FARVersionHistory",
      "activeTab === 'history' && <HistoryTab",
    ])
    expectAll(historySource, [
      'Version History',
      '/restore/${version}',
      'Forensic lineage records causal and intervention changes.',
      'Core restore preserves current interventions and the independent Active / Archived lifecycle.',
      'entry.delta',
      'entry.forensic_changed_fields',
    ])
    expectAll(historyContractSource, [
      'getFarHistoryRestoreAction',
      'Restore lifecycle first',
      'Current content',
      'No core change',
      'Restore FAR-owned core content while preserving current intervention objects and lifecycle state',
    ])
    expect(formatFarHistoryValue(['a', 2, true])).toBe('a, 2, true')
    expect(getFarHistoryRestoreAction({
      isArchived: true,
      isCurrent: false,
      isPending: false,
      coreRestoreAvailable: true,
      version: 2,
    })).toMatchObject({ disabled: true, label: 'Restore lifecycle first' })
    expect(getFarHistoryRestoreAction({
      isArchived: false,
      isCurrent: false,
      isPending: false,
      coreRestoreAvailable: true,
      version: 2,
    })).toMatchObject({ disabled: false, label: 'Restore core v2' })
  })

  it('G84/G85/G87 place main authoring in the standard workspace modal, sticky identity and tabbed complex-form pattern', () => {
    expectAll(farSource, [
      'function FARAuthoringModal',
      '<WorkspaceModal',
      'size="workspace"',
      "{ id: 'definition', label: 'Definition', badgeCount: tabErrors.definition }",
      "{ id: 'risk', label: 'Risk', badgeCount: tabErrors.risk }",
      "{ id: 'impact', label: 'Impact', badgeCount: tabErrors.impact }",
      'tabs={tabs}',
      'activeTab={activeTab}',
      '<WorkspaceStickyIdentityBar>',
      '</WorkspaceStickyIdentityBar>',
    ])
  })

  it('G88/G89/G90 provide inline validation, tab counts and systematic required identity fields', () => {
    expect(isFarAuthoringFieldRequired('system_name')).toBe(true)
    expect(isFarAuthoringFieldRequired('failure_type')).toBe(true)
    expect(isFarAuthoringFieldRequired('title')).toBe(true)
    const errors = buildFarAuthoringErrors({
      system_name: '', failure_type: '', title: '', severity: 0, occurrence: 11, detection: 2.5,
    })
    expect(getFarAuthoringTabErrorCounts(errors)).toEqual({ definition: 3, risk: 3, impact: 0 })
    expect(getFarAuthoringFirstErrorTab(errors)).toBe('definition')
    expectAll(authoringSource, [
      "const FAR_REQUIRED_FIELDS = new Set(['system_name', 'failure_type', 'title'])",
      'buildFarAuthoringErrors',
      'getFarAuthoringTabErrorCounts',
      'getFarAuthoringFirstErrorTab',
    ])
    expectAll(farSource, [
      '<WorkspaceValidationBanner',
      'error={formErrors.system_name}',
      'error={formErrors.failure_type}',
      '<WorkspaceFieldLabel label="Incidence Signature" required />',
      'aria-invalid={Boolean(formErrors.title)}',
      '<WorkspaceFieldError message={formErrors.title} />',
    ])
  })

  it('G91/G92/G93 provide collapsible sections, searchable relationships and standardized footer actions', () => {
    expectAll(farSource, [
      '<WorkspaceCollapsibleHeader',
      'collapsed={collapsedSections.identity}',
      'collapsed={collapsedSections.context}',
      'collapsed={collapsedSections.risk}',
      'collapsed={collapsedSections.assets}',
      'label="Operational Domain"',
      'label="Affected Infrastructure"',
      'searchable',
      'multi',
      'footerLeft={(',
      'footerRight={(',
      "mutation.isPending ? 'Committing…' : 'Commit'",
    ])
  })

  it('keeps all seven existing regression-lock rows out of the new-closure count', () => {
    const newRows = new Set<string>(PC49_NEW_CLOSURE_ROWS)
    for (const row of PC49_REGRESSION_LOCK_ROWS) expect(newRows.has(row)).toBe(false)
  })
})
