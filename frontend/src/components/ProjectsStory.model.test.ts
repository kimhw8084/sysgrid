import { describe, expect, it } from 'vitest'
import { PROJECT_TEMPLATES, applyProjectTemplate, blankCreationDraft, hasPartialProjectResourceCoverage, homePrimaryAction, lifecycleMessage, projectBucket, projectCreationRecoveryStorageKey, projectCurrentOwnerId, normalizeProjectOwnerIdForDisplay, resolveProjectCurrentOperator, sortPortfolioItems, type ProjectStoryItem } from './ProjectsStory.model'

const project = (overrides: Partial<ProjectStoryItem> = {}): ProjectStoryItem => ({
  id: 'p-1', display_key: 'PRJ-000001', name: 'Qualification Analysis Automation', objective: 'Reduce manual review time while preserving qualification evidence.', owner_id: 'mina.chen', phase: 'Executing', run_state: 'Active', priority: 'High', architecture_assessment: 'Yes', outcome_phase: 'Pilot', outcome_result: 'Unassessed', revision: 1, graph_revision: 1,
  capabilities: { view: true, edit: true },
  story: { health: { level: 'At risk', reason: 'Validation dataset approval' }, delivery: { percent: 58, label: '58%', method: 'Weighted by canonical planning weight.' }, next_milestone: null, milestones: [], attention: [], attention_count: 0, acceptance_criteria: [], primary_metric: null, latest_update: null, governance: [], architecture: { assessment: 'Yes' }, resources: [], freshness: { source: 'Canonical Project projection' }, coverage: {} },
  ...overrides,
})

describe('P04 Project story model', () => {
  it('resolves trusted proxy identities to canonical operator owners and isolates local recovery by account', () => {
    const operators = [{ username: 'haewon', external_id: 'company-user-42', team_id: 42 }, { username: 'other', external_id: 'company-user-99', team_id: 99 }]
    const current = resolveProjectCurrentOperator(operators, 'company-user-42')
    expect(current).toBe(operators[0])
    expect(projectCurrentOwnerId(current, 'company-user-42')).toBe('haewon')
    expect(resolveProjectCurrentOperator(operators, 'missing')).toBeNull()
    expect(projectCurrentOwnerId(null, 'missing')).toBe('missing')
    expect(normalizeProjectOwnerIdForDisplay('  mina.chen  ')).toBe('mina.chen')
    expect(normalizeProjectOwnerIdForDisplay('legacy:unresolved:PRJ-000001')).toBeNull()
    expect(normalizeProjectOwnerIdForDisplay('  ')).toBeNull()
    expect(projectCreationRecoveryStorageKey('company/user-42')).toBe('sysgrid_projects_creation_recovery_v1:company%2Fuser-42')
    expect(projectCreationRecoveryStorageKey('company-user-42')).not.toBe(projectCreationRecoveryStorageKey('company-user-99'))
  })

  it('suppresses partial-resource warnings for an empty portfolio', () => {
    expect(hasPartialProjectResourceCoverage({ items: [], coverage: { resources: 'partial' } })).toBe(false)
    expect(hasPartialProjectResourceCoverage({ items: [project()], coverage: { resources: 'partial' } })).toBe(true)
  })
  it('defines exactly seven versioned templates without dates, numeric targets, or links', () => {
    expect(PROJECT_TEMPLATES).toHaveLength(7)
    expect(PROJECT_TEMPLATES.map((item) => item.name)).toEqual(['Automation', 'Product/feature', 'Infrastructure/platform', 'Reliability', 'Engineering improvement', 'Experiment', 'Process improvement'])
    expect(new Set(PROJECT_TEMPLATES.map((item) => item.version))).toEqual(new Set(['1.0.0']))
    expect(JSON.stringify(PROJECT_TEMPLATES)).not.toMatch(/https?:\/\//)
    expect(JSON.stringify(PROJECT_TEMPLATES)).not.toMatch(/target_spec|point_date|202\d-/)
  })

  it('instantiates every template only through explicit acceptance and leaves fabricated values blank', () => {
    const blank = blankCreationDraft('mina.chen')
    expect(blank.milestones).toEqual([])
    expect(blank.acceptance_criteria).toEqual([])
    for (const template of PROJECT_TEMPLATES) {
      const applied = applyProjectTemplate(blank, template, 'mina.chen')
      expect(applied.suggestions_accepted).toBe(true)
      expect(applied.acceptance_criteria).toEqual(template.acceptanceCriteria)
      expect(applied.milestones.map((item) => item.title)).toEqual(template.milestones)
      expect(applied.milestones.every((item) => item.point_date === null)).toBe(true)
      expect(applied.metric.target_spec).toBeNull()
    }
  })

  it('uses exclusive delivery buckets while preserving attention-first stable ordering', () => {
    expect(projectBucket(project({ phase: 'Draft' }))).toBe('Planned')
    expect(projectBucket(project({ phase: 'Delivered' }))).toBe('Delivered')
    expect(projectBucket(project({ phase: 'Executing', run_state: 'Paused' }))).toBe('Paused')
    const sorted = sortPortfolioItems([
      project({ id: 'green', display_key: 'PRJ-2', story: { ...project().story, health: { level: 'On track', reason: 'Clear' } } }),
      project({ id: 'red', display_key: 'PRJ-1', story: { ...project().story, health: { level: 'Off track', reason: 'Blocked' } } }),
    ], 'attention')
    expect(sorted.map((item) => item.id)).toEqual(['red', 'green'])

    const decisionFirst = sortPortfolioItems([
      project({ id: 'risk', display_key: 'PRJ-1', story: { ...project().story, health: { level: 'Off track', reason: 'Blocked' } } }),
      project({ id: 'decision', display_key: 'PRJ-2', story: { ...project().story, health: { level: 'On track', reason: 'Clear' }, governance: [{ id: 'd1', type: 'Decision', title: 'Approve pilot', state: 'Open', approver_id: 'mina.chen' }] } }),
    ], 'attention', 'mina.chen')
    expect(decisionFirst.map((item) => item.id)).toEqual(['decision', 'risk'])
  })

  it('changes the primary action and banner by lifecycle and permission without changing Home facts', () => {
    expect(homePrimaryAction(project({ phase: 'Draft' })).label).toBe('Complete setup')
    expect(homePrimaryAction(project({ phase: 'Delivered' })).label).toBe('Record measurement')
    expect(homePrimaryAction(project({ capabilities: { view: true, edit: false } })).label).toBe('View plan')
    expect(homePrimaryAction(project({ run_state: 'Paused' })).label).toBe('View plan')
    expect(homePrimaryAction(project({ archived_at: '2026-09-01T00:00:00Z' })).label).toBe('View plan')
    expect(lifecycleMessage(project({ run_state: 'Paused', pause_reason: 'Capacity held' }))).toContain('Capacity held')
    expect(lifecycleMessage(project({ run_state: 'Cancelled', cancellation_reason: 'Strategy changed' }))).toContain('Strategy changed')
    expect(lifecycleMessage(project({ archived_at: '2026-09-01T00:00:00Z' }))).toContain('read-only')
  })
})
