export type PV1Health = 'Off track' | 'At risk' | 'Unknown' | 'On track'
export type PV1Phase = 'Draft' | 'Proposed' | 'Planning' | 'Ready' | 'Executing' | 'Validating' | 'Delivered'
export type PV1RunState = 'Active' | 'Paused' | 'Cancelled'

export type ProjectStoryItem = {
  id: string
  display_key: string
  legacy_project_id?: number | null
  name: string
  objective?: string | null
  problem?: string | null
  in_scope?: string | null
  out_of_scope?: string | null
  team_id?: number | null
  owner_id: string
  phase: PV1Phase
  run_state: PV1RunState
  priority: string
  start_date?: string | null
  target_date?: string | null
  no_deadline_reason?: string | null
  template_key?: string | null
  template_version?: string | null
  parent_project_id?: string | null
  child_count?: number
  architecture_assessment: 'Yes' | 'No' | 'Not assessed'
  architecture_rationale?: string | null
  outcome_phase: string
  outcome_result: string
  revision: number
  graph_revision: number
  updated_at?: string | null
  pause_reason?: string | null
  cancellation_reason?: string | null
  resume_review_date?: string | null
  archived_at?: string | null
  creation_draft?: CreationDraft | null
  capabilities: Record<string, boolean>
  story: ProjectStory
}

export type StoryTask = {
  id: string
  title: string
  owner_id?: string | null
  point_date?: string | null
  end_date?: string | null
  status: string
}

export type ProjectStory = {
  health: { level: PV1Health; reason: string }
  delivery: { percent: number | null; label: string; method: string }
  next_milestone: StoryTask | null
  milestones: StoryTask[]
  attention: Array<{ id: string; kind: string; reason: string; accountable: string; due_date?: string | null; action: string; entity_id?: string | null }>
  attention_count: number
  acceptance_criteria: Array<{ id: string; description: string; state: string; mandatory: boolean }>
  primary_metric: { id: string; name: string; kind: string; unit: string; target: string | number | null; current: string | number | boolean | null; quality?: string | null; measured_at?: string | null; next_measurement_date?: string | null; steward_id: string } | null
  latest_update: { id?: string; content?: unknown; published_at?: string; author_id?: string; text?: string } | null
  governance: Array<{ id: string; type: string; title: string; state: string; owner_id?: string | null; approver_id?: string | null }>
  architecture: { assessment: string; rationale?: string | null }
  resources: Array<{ id?: string; title?: string; name?: string; url?: string }>
  freshness: { updated_at?: string | null; source: string }
  coverage: Record<string, string>
}

export type PortfolioResponse = {
  items: ProjectStoryItem[]
  summary: Record<'Planned' | 'Active' | 'Delivered' | 'Paused' | 'Cancelled' | 'Needs attention' | 'Measuring' | 'Realized' | 'Closed below target', number>
  as_of: string
  source_revision: string
  coverage: Record<string, string>
}

export type ProjectOperatorIdentity = { username?: string | null; external_id?: string | null; team_id?: number | string | null }

export const resolveProjectCurrentOperator = (operators: unknown, userId: unknown): ProjectOperatorIdentity | null => {
  if (!Array.isArray(operators) || typeof userId !== 'string' || !userId.trim()) return null
  const identity = userId.trim()
  return (operators as ProjectOperatorIdentity[]).find((operator) => operator.username === identity || operator.external_id === identity) || null
}

export const projectCurrentOwnerId = (operator: ProjectOperatorIdentity | null, fallback: string) => operator?.username || operator?.external_id || fallback

export const normalizeProjectOwnerIdForDisplay = (ownerId?: string | null): string | null => {
  const normalized = ownerId?.trim()
  return normalized && !normalized.toLowerCase().startsWith('legacy:unresolved') ? normalized : null
}

export const projectCreationRecoveryStorageKey = (userId: string) => `sysgrid_projects_creation_recovery_v1:${encodeURIComponent(userId)}`

export const hasPartialProjectResourceCoverage = (portfolio?: Pick<PortfolioResponse, 'items' | 'coverage'>) => Boolean(portfolio?.items.length && portfolio.coverage.resources === 'partial')

export type CreationDraft = {
  draft_step: number
  acceptance_criteria: string[]
  metric: {
    name: string
    kind: 'Adoption' | 'Value' | 'Quality' | 'Reliability' | 'Decision' | 'Custom'
    unit: string
    direction: 'Increase' | 'Decrease' | 'Within range' | 'Binary'
    measurement_method: string
    steward_id: string
    target_spec: Record<string, unknown> | null
  }
  milestones: Array<{ title: string; owner_id: string | null; point_date: string | null }>
  collaborators: string[]
  dependencies: string[]
  suggestions_accepted: boolean
}

export type ProjectTemplate = {
  key: string
  name: string
  version: '1.0.0'
  acceptanceCriteria: string[]
  milestones: string[]
  metricName: string
  metricUnit: string
  metricKind: CreationDraft['metric']['kind']
  metricDirection: CreationDraft['metric']['direction']
}

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  { key: 'automation', name: 'Automation', version: '1.0.0', acceptanceCriteria: ['The agreed eligible workflow runs through the automated path', 'Fallback and evidence trace are verified'], milestones: ['Baseline measured', 'Prototype', 'Validation', 'Pilot', 'Rollout'], metricName: 'Eligible workflows adopted; hours recovered', metricUnit: 'workflows or hours', metricKind: 'Adoption', metricDirection: 'Increase' },
  { key: 'product-feature', name: 'Product/feature', version: '1.0.0', acceptanceCriteria: ['The agreed user workflow is available', 'Launch evidence and support ownership are verified'], milestones: ['Discovery', 'Design', 'Build', 'Validation', 'Launch'], metricName: 'Eligible users/workflows using the feature; agreed success measure', metricUnit: 'users or workflows', metricKind: 'Adoption', metricDirection: 'Increase' },
  { key: 'infrastructure-platform', name: 'Infrastructure/platform', version: '1.0.0', acceptanceCriteria: ['Migration and rollback procedures are verified', 'Service ownership and operating evidence are available'], milestones: ['Baseline', 'Design', 'Build', 'Migration rehearsal', 'Cutover', 'Stabilization'], metricName: 'Service adoption; verified capacity/reliability improvement', metricUnit: 'service measure', metricKind: 'Reliability', metricDirection: 'Increase' },
  { key: 'reliability', name: 'Reliability', version: '1.0.0', acceptanceCriteria: ['The mitigation is deployed to the agreed scope', 'Reliability evidence is observed over the agreed period'], milestones: ['Baseline incident analysis', 'Mitigation', 'Validation', 'Rollout', 'Observation'], metricName: 'Incident frequency or recovery-time improvement', metricUnit: 'incidents or time', metricKind: 'Reliability', metricDirection: 'Decrease' },
  { key: 'engineering-improvement', name: 'Engineering improvement', version: '1.0.0', acceptanceCriteria: ['The improved engineering path is documented and usable', 'Pilot evidence and rollout ownership are verified'], milestones: ['Baseline process', 'Proposal', 'Pilot', 'Evaluation', 'Rollout'], metricName: 'Cycle-time/quality improvement', metricUnit: 'time or quality', metricKind: 'Quality', metricDirection: 'Increase' },
  { key: 'experiment', name: 'Experiment', version: '1.0.0', acceptanceCriteria: ['The agreed protocol is executed', 'Evidence supports an explicit decision regardless of hypothesis result'], milestones: ['Hypothesis', 'Protocol', 'Execute', 'Analyze', 'Decision'], metricName: 'Evidence quality and decision outcome, not guaranteed positive result', metricUnit: 'decision evidence', metricKind: 'Decision', metricDirection: 'Binary' },
  { key: 'process-improvement', name: 'Process improvement', version: '1.0.0', acceptanceCriteria: ['The improved workflow is documented and trialed', 'Training and accountable ownership are in place'], milestones: ['Current workflow', 'Improved workflow', 'Trial', 'Training', 'Adoption review'], metricName: 'Eligible group adherence and measured quality/time change', metricUnit: 'process measure', metricKind: 'Quality', metricDirection: 'Increase' },
] as const

export const blankCreationDraft = (ownerId = ''): CreationDraft => ({
  draft_step: 0,
  acceptance_criteria: [],
  metric: { name: '', kind: 'Custom', unit: '', direction: 'Increase', measurement_method: '', steward_id: ownerId, target_spec: null },
  milestones: [],
  collaborators: [],
  dependencies: [],
  suggestions_accepted: false,
})

export const applyProjectTemplate = (draft: CreationDraft, template: ProjectTemplate, ownerId: string): CreationDraft => ({
  ...draft,
  acceptance_criteria: [...template.acceptanceCriteria],
  milestones: template.milestones.map((title) => ({ title, owner_id: ownerId || null, point_date: null })),
  metric: { ...draft.metric, name: template.metricName, unit: template.metricUnit, kind: template.metricKind, direction: template.metricDirection, steward_id: ownerId || draft.metric.steward_id },
  suggestions_accepted: true,
})

export const projectBucket = (project: ProjectStoryItem): 'Planned' | 'Active' | 'Delivered' | 'Paused' | 'Cancelled' => {
  if (project.run_state === 'Paused') return 'Paused'
  if (project.run_state === 'Cancelled') return 'Cancelled'
  if (project.phase === 'Delivered') return 'Delivered'
  if (project.phase === 'Executing' || project.phase === 'Validating') return 'Active'
  return 'Planned'
}

const healthRank: Record<PV1Health, number> = { 'Off track': 0, 'At risk': 1, Unknown: 2, 'On track': 3 }

export type PortfolioSort = 'attention' | 'target' | 'name'
export const sortPortfolioItems = (items: ProjectStoryItem[], sort: PortfolioSort, currentUserId = ''): ProjectStoryItem[] => [...items].sort((left, right) => {
  if (sort === 'name') return left.name.localeCompare(right.name) || left.display_key.localeCompare(right.display_key)
  if (sort === 'target') {
    const leftTarget = left.target_date || '9999-12-31'
    const rightTarget = right.target_date || '9999-12-31'
    return leftTarget.localeCompare(rightTarget) || left.display_key.localeCompare(right.display_key)
  }
  const decisionRank = (project: ProjectStoryItem) => project.story.governance.some((item) => item.type === 'Decision' && !['Closed', 'Resolved', 'Approved', 'Rejected'].includes(item.state) && item.approver_id === currentUserId) ? 0 : 1
  return (decisionRank(left) - decisionRank(right))
    || (healthRank[left.story.health.level] - healthRank[right.story.health.level])
    || ((left.target_date || '9999-12-31').localeCompare(right.target_date || '9999-12-31'))
    || left.display_key.localeCompare(right.display_key)
})

export const homePrimaryAction = (project: ProjectStoryItem): { label: string; href: string } => {
  if (project.archived_at || project.run_state === 'Cancelled' || project.run_state === 'Paused') return { label: 'View plan', href: `/projects/${encodeURIComponent(project.id)}/plan` }
  if (project.phase === 'Draft') return { label: 'Complete setup', href: `/projects/new?draft=${encodeURIComponent(project.id)}` }
  if (project.phase === 'Delivered') return { label: 'Record measurement', href: `/projects/${encodeURIComponent(project.id)}/outcomes?section=measurements` }
  if (!project.capabilities.edit) return { label: 'View plan', href: `/projects/${encodeURIComponent(project.id)}/plan` }
  if (project.story.attention.some((item) => item.kind === 'Late update')) return { label: 'Draft update', href: `/projects/${encodeURIComponent(project.id)}/updates?section=draft` }
  return { label: 'Open work', href: `/projects/${encodeURIComponent(project.id)}/work` }
}

export const lifecycleMessage = (project: ProjectStoryItem): string | null => {
  if (project.archived_at) return 'Archived — this project is read-only; history remains available for search and export.'
  if (project.run_state === 'Paused') return `Paused${project.pause_reason ? ` — ${project.pause_reason}` : ''}${project.resume_review_date ? ` · review ${project.resume_review_date}` : ''}`
  if (project.run_state === 'Cancelled') return `Cancelled${project.cancellation_reason ? ` — ${project.cancellation_reason}` : ''}`
  if (project.phase === 'Draft') return 'Draft — complete the purpose and success story before creating the project.'
  if (project.phase === 'Delivered') return 'Delivered — delivery is complete; outcome measurement remains independent.'
  return null
}

export const projectUpdateText = (update: ProjectStory['latest_update']): string => {
  if (!update) return 'No published update yet.'
  if (typeof update.text === 'string' && update.text.trim()) return update.text.trim()
  if (typeof update.content === 'string') return update.content
  if (update.content && typeof update.content === 'object') {
    const content = update.content as Record<string, unknown>
    for (const key of ['summary', 'text', 'headline']) if (typeof content[key] === 'string' && String(content[key]).trim()) return String(content[key]).trim()
  }
  return 'Published update is available.'
}
