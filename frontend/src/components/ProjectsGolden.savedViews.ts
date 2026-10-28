import {
  normalizeProjectSavedViewState,
  projectSavedViewFromWorkspaceDefinition,
  projectSavedViewToWorkspaceDefinition,
  type ProjectSavedViewState,
} from './ProjectsGolden.model'

const MAX_PROJECT_SAVED_VIEW_OPTIONS = 200

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
)

type ProjectSavedViewSection = 'control' | 'roadmap' | 'owners' | 'review' | 'governance'

const PROJECT_LOCAL_SAVED_VIEW_SECTION_KEY = 'sysgrid_projects_saved_view_sections_v1'
const PROJECT_SAVED_VIEW_SECTION_FILTER_PREFIX = 'sysgrid:project-section:'
const PROJECT_LOCAL_SAVED_VIEW_FRESH_MS = 60_000
const PROJECT_WORKBENCH_STORAGE_KEYS = ['sysgrid_projects_workbench_v1', 'sysgrid_projects_execution_intelligence_v1'] as const
const PROJECT_PORTFOLIO_SECTIONS = new Set<ProjectSavedViewSection>(['control', 'roadmap', 'owners'])
const PROJECT_INSIGHT_SECTIONS = new Set<ProjectSavedViewSection>(['review', 'governance'])

let projectSavedViewIdentityTimer: number | null = null
let projectSavedViewStaleLinkTimer: number | null = null
let projectSavedViewTeamResolution: number | null | undefined = undefined
const PROJECT_SAVED_VIEW_TEAM_RESOLUTION_RETRY_MS = 50
const PROJECT_SAVED_VIEW_TEAM_RESOLUTION_MAX_RETRIES = 200

const normalizeProjectSavedViewSection = (value: unknown): ProjectSavedViewSection | null => (
  typeof value === 'string' && (PROJECT_PORTFOLIO_SECTIONS.has(value as ProjectSavedViewSection) || PROJECT_INSIGHT_SECTIONS.has(value as ProjectSavedViewSection))
    ? value as ProjectSavedViewSection
    : null
)

const projectSavedViewTopLevelForSection = (section: ProjectSavedViewSection) => (
  PROJECT_PORTFOLIO_SECTIONS.has(section) ? 'portfolio' : 'insights'
)

const projectSavedViewDefaultSection = (state: ProjectSavedViewState): ProjectSavedViewSection | null => (
  state.view === 'portfolio' ? 'control' : state.view === 'insights' ? 'review' : null
)

const projectSavedViewRawTopLevel = (value: unknown): string => {
  const record = asRecord(value)
  if (!record) return ''
  const rawView = typeof record.view === 'string' ? record.view : typeof record.activeTab === 'string' ? record.activeTab : ''
  const aliasSection = normalizeProjectSavedViewSection(rawView)
  return aliasSection ? projectSavedViewTopLevelForSection(aliasSection) : rawView
}

const normalizeProjectSavedViewStateForSections = (value: unknown): ProjectSavedViewState => {
  const record = asRecord(value)
  if (!record) return normalizeProjectSavedViewState(value)
  const rawView = typeof record.view === 'string' ? record.view : ''
  const aliasSection = normalizeProjectSavedViewSection(rawView)
  return aliasSection && !['control', 'review'].includes(aliasSection)
    ? normalizeProjectSavedViewState({ ...record, view: projectSavedViewTopLevelForSection(aliasSection) })
    : normalizeProjectSavedViewState(value)
}

const projectSavedViewSectionFromValue = (value: unknown): ProjectSavedViewSection | null => {
  const record = asRecord(value)
  if (!record) return null
  const rawView = typeof record.view === 'string' ? record.view : typeof record.activeTab === 'string' ? record.activeTab : ''
  const aliasSection = normalizeProjectSavedViewSection(rawView)
  if (aliasSection && !['control', 'review'].includes(aliasSection)) return aliasSection
  const filters = asRecord(record.filters)
  const watch = Array.isArray(filters?.watch) ? filters.watch : []
  const encoded = watch.flatMap((entry) => {
    if (typeof entry !== 'string' || !entry.startsWith(PROJECT_SAVED_VIEW_SECTION_FILTER_PREFIX)) return []
    const section = normalizeProjectSavedViewSection(entry.slice(PROJECT_SAVED_VIEW_SECTION_FILTER_PREFIX.length))
    return section ? [section] : []
  })[0] || null
  const explicit = normalizeProjectSavedViewSection(record.section)
  const section = explicit || encoded
  if (!section) return null
  return projectSavedViewRawTopLevel(value) === projectSavedViewTopLevelForSection(section) ? section : null
}

export const projectSavedViewSectionFromSearch = (value: unknown): ProjectSavedViewSection | null => {
  if (typeof value !== 'string') return null
  const params = new URLSearchParams(value.startsWith('?') ? value.slice(1) : value)
  const rawView = params.get('view') || ''
  const aliasSection = normalizeProjectSavedViewSection(rawView)
  if (aliasSection && !['control', 'review'].includes(aliasSection)) return aliasSection
  const section = normalizeProjectSavedViewSection(params.get('section'))
  if (!section) return null
  const topLevel = rawView === 'roadmap' || rawView === 'owners' ? 'portfolio' : rawView === 'governance' || rawView === 'review' ? 'insights' : rawView
  return topLevel === projectSavedViewTopLevelForSection(section) ? section : null
}

const currentProjectSavedViewSection = () => (
  typeof window === 'undefined' ? null : projectSavedViewSectionFromSearch(window.location.search)
)

const projectSavedViewStateWithSection = (value: unknown, section: ProjectSavedViewSection | null): ProjectSavedViewState => {
  const normalized = normalizeProjectSavedViewStateForSections(value)
  if (!section || normalized.view !== projectSavedViewTopLevelForSection(section)) return normalized
  if (section === 'control' || section === 'review') return normalized
  return { ...normalized, view: section as ProjectSavedViewState['view'] }
}

const readLocalProjectSavedViewSections = (): Record<string, ProjectSavedViewSection> => {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROJECT_LOCAL_SAVED_VIEW_SECTION_KEY) || '{}')
    const record = asRecord(parsed) || {}
    return Object.fromEntries(Object.entries(record).flatMap(([key, value]) => {
      const section = normalizeProjectSavedViewSection(value)
      return section ? [[key, section]] : []
    }))
  } catch { return {} }
}

const isFreshLocalProjectSavedViewId = (rawId: string) => {
  if (!/^\d{12,16}$/.test(rawId)) return false
  const createdAt = Number(rawId)
  return Number.isSafeInteger(createdAt) && Math.abs(Date.now() - createdAt) <= PROJECT_LOCAL_SAVED_VIEW_FRESH_MS
}

const persistLocalProjectSavedViewSection = (rawId: string, section: ProjectSavedViewSection) => {
  if (typeof window === 'undefined') return
  for (const key of PROJECT_WORKBENCH_STORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const record = asRecord(parsed)
      if (!record || !Array.isArray(record.savedViews)) continue
      let changed = false
      const savedViews = record.savedViews.map((entry) => {
        const saved = asRecord(entry)
        const id = saved && (typeof saved.id === 'string' || typeof saved.id === 'number') ? String(saved.id).trim() : ''
        if (!saved || id !== rawId || projectSavedViewSectionFromValue(saved)) return entry
        changed = true
        return { ...saved, section }
      })
      if (changed) window.localStorage.setItem(key, JSON.stringify({ ...record, savedViews }))
    } catch {}
  }
}

const captureNewLocalProjectSavedViewSections = (value: unknown[]) => {
  const sections = readLocalProjectSavedViewSections()
  const currentSection = currentProjectSavedViewSection()
  let changed = false
  value.forEach((entry) => {
    const record = asRecord(entry)
    const rawId = record && (typeof record.id === 'string' || typeof record.id === 'number') ? String(record.id).trim() : ''
    if (!rawId) return
    const explicit = projectSavedViewSectionFromValue(record)
    if (explicit) {
      if (sections[rawId] !== explicit) { sections[rawId] = explicit; changed = true }
      return
    }
    if (sections[rawId] || !currentSection || !isFreshLocalProjectSavedViewId(rawId)) return
    const normalized = normalizeProjectSavedViewStateForSections(record)
    if (normalized.view !== projectSavedViewTopLevelForSection(currentSection)) return
    record.section = currentSection
    sections[rawId] = currentSection
    persistLocalProjectSavedViewSection(rawId, currentSection)
    changed = true
  })
  if (changed && typeof window !== 'undefined') {
    try { window.localStorage.setItem(PROJECT_LOCAL_SAVED_VIEW_SECTION_KEY, JSON.stringify(sections)) } catch {}
  }
  return sections
}

export type ProjectSavedViewScope = 'personal' | 'team'

export const normalizeProjectSavedViewName = (value: unknown) => (
  typeof value === 'string' ? value.split(/\s+/).filter(Boolean).join(' ').slice(0, 120) : ''
)

export interface ProjectSavedViewOption {
  id: string
  name: string
  source: 'local' | 'remote'
  state: ProjectSavedViewState
  remoteId?: number
  revision?: number
  scope?: ProjectSavedViewScope
  teamId?: number | null
  isFavorite?: boolean
  isDefault?: boolean
}

export interface ProjectRemoteSavedViewRecord {
  id: number
  workspace_key: 'projects'
  name: string
  scope: ProjectSavedViewScope
  owner_user_id?: string
  team_id: number | null
  definition: Record<string, unknown>
  schema_version: 1
  revision: number
  is_favorite?: boolean
  is_default?: boolean
  created_at?: string | null
  updated_at?: string | null
}

export interface ProjectSavedViewConflict {
  message: string
  current: ProjectRemoteSavedViewRecord
  option: ProjectSavedViewOption
}

const localProjectSavedViewOptions = (value: unknown): ProjectSavedViewOption[] => {
  if (!Array.isArray(value)) return []
  const storedSections = captureNewLocalProjectSavedViewSections(value)
  return value.slice(0, MAX_PROJECT_SAVED_VIEW_OPTIONS).flatMap((entry, index) => {
    const record = asRecord(entry)
    if (!record) return []
    const name = normalizeProjectSavedViewName(record.name)
    if (!name) return []
    const rawId = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id).trim() : ''
    return [{
      id: `local:${rawId || `legacy-${index + 1}`}:${index}`,
      name,
      source: 'local' as const,
      state: projectSavedViewStateWithSection(record, storedSections[rawId] || projectSavedViewSectionFromValue(record)),
    }]
  })
}

export const projectSavedViewOptionFromRemoteRecord = (entry: unknown): ProjectSavedViewOption | null => {
  const record = asRecord(entry)
  const definition = record ? asRecord(record.definition) : null
  if (!record || !definition) return null
  if (record.workspace_key !== undefined && record.workspace_key !== 'projects') return null
  const scope: ProjectSavedViewScope | null = record.scope === 'team'
    ? 'team'
    : record.scope === 'personal' || record.scope === undefined ? 'personal' : null
  if (!scope) return null
  const teamId = record.team_id == null ? null : Number(record.team_id)
  if (scope === 'personal' && teamId !== null) return null
  if (scope === 'team' && (!Number.isSafeInteger(teamId) || Number(teamId) < 1)) return null
  if (record.schema_version !== 1) return null
  const id = Number(record.id)
  const name = normalizeProjectSavedViewName(record.name)
  const revision = Number(record.revision)
  if (!Number.isSafeInteger(id) || id < 1 || !name) return null
  if (!Number.isSafeInteger(revision) || revision < 1) return null
  if (!['searchTerm', 'filters', 'activeTab', 'mode'].some((key) => key in definition)) return null
  return {
    id: `remote:${id}`,
    name,
    source: 'remote',
    remoteId: id,
    revision,
    scope,
    teamId,
    isFavorite: record.is_favorite === true,
    isDefault: record.is_default === true,
    state: projectSavedViewStateWithSection(projectSavedViewFromWorkspaceDefinition(definition), projectSavedViewSectionFromValue(definition)),
  }
}

const remoteProjectSavedViewOptions = (
  value: unknown,
  expectedScope: ProjectSavedViewScope,
  expectedTeamId?: number | null,
): ProjectSavedViewOption[] => {
  const payload = asRecord(value)
  const views = payload && Array.isArray(payload.views) ? payload.views : []
  const seen = new Set<number>()
  const result: ProjectSavedViewOption[] = []

  views.slice(0, MAX_PROJECT_SAVED_VIEW_OPTIONS).forEach((entry) => {
    const option = projectSavedViewOptionFromRemoteRecord(entry)
    if (!option?.remoteId || seen.has(option.remoteId) || option.scope !== expectedScope) return
    if (expectedScope === 'team' && option.teamId !== expectedTeamId) return
    seen.add(option.remoteId)
    result.push(option)
  })
  return result.sort((left, right) => (
    Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault))
    || Number(Boolean(right.isFavorite)) - Number(Boolean(left.isFavorite))
  ))
}

const hasAuthoritativeProjectSavedViewPayload = (value: unknown) => {
  const payload = asRecord(value)
  return Boolean(payload && Array.isArray(payload.views))
}

const cancelProjectSavedViewStaleLinkCleanup = () => {
  if (typeof window === 'undefined' || projectSavedViewStaleLinkTimer === null) return
  window.clearTimeout(projectSavedViewStaleLinkTimer)
  projectSavedViewStaleLinkTimer = null
}

const scheduleProjectSavedViewTeamResolutionWait = (linkedId: number) => {
  if (typeof window === 'undefined' || projectSavedViewStaleLinkTimer !== null) return
  let retries = 0
  const resume = () => {
    projectSavedViewStaleLinkTimer = null
    if (projectSavedViewLinkedRemoteId(new URLSearchParams(window.location.search).get('saved_view')) !== linkedId) return
    if (projectSavedViewTeamResolution === undefined) {
      retries += 1
      if (retries >= PROJECT_SAVED_VIEW_TEAM_RESOLUTION_MAX_RETRIES) return
      projectSavedViewStaleLinkTimer = window.setTimeout(resume, PROJECT_SAVED_VIEW_TEAM_RESOLUTION_RETRY_MS)
      return
    }
    if (projectSavedViewTeamResolution === null) scheduleProjectSavedViewIdentity(null, linkedId)
  }
  projectSavedViewStaleLinkTimer = window.setTimeout(resume, 0)
}

export const reconcileProjectSavedViewOptions = (
  localValue: unknown,
  personalRemoteValue: unknown,
  teamRemoteValue?: unknown,
  currentTeamId?: number | null,
): ProjectSavedViewOption[] => {
  const personal = remoteProjectSavedViewOptions(personalRemoteValue, 'personal')
  const normalizedTeamId = Number.isSafeInteger(currentTeamId) && Number(currentTeamId) > 0 ? Number(currentTeamId) : null
  const team = normalizedTeamId ? remoteProjectSavedViewOptions(teamRemoteValue, 'team', normalizedTeamId) : []
  const result = [...personal, ...team, ...localProjectSavedViewOptions(localValue)]

  if (typeof window !== 'undefined') {
    const linkedId = projectSavedViewLinkedRemoteId(new URLSearchParams(window.location.search).get('saved_view'))
    if (!linkedId || result.some((option) => option.source === 'remote' && option.remoteId === linkedId)) {
      cancelProjectSavedViewStaleLinkCleanup()
    } else {
      const personalAuthoritative = hasAuthoritativeProjectSavedViewPayload(personalRemoteValue)
      const teamAuthoritative = projectSavedViewTeamResolution === null
        || (Number.isSafeInteger(projectSavedViewTeamResolution)
          && Number(projectSavedViewTeamResolution) > 0
          && hasAuthoritativeProjectSavedViewPayload(teamRemoteValue))
      if (personalAuthoritative && projectSavedViewTeamResolution === undefined) {
        scheduleProjectSavedViewTeamResolutionWait(linkedId)
      } else if (personalAuthoritative && teamAuthoritative && projectSavedViewStaleLinkTimer === null) {
        projectSavedViewStaleLinkTimer = window.setTimeout(() => {
          projectSavedViewStaleLinkTimer = null
          scheduleProjectSavedViewIdentity(null, linkedId)
        }, 0)
      }
    }
  }

  return result
}

export const projectSavedViewOptionLabel = (option: ProjectSavedViewOption) => {
  if (option.source === 'local') return `${option.name} · Local`
  const scopeLabel = option.scope === 'team' ? 'Team' : 'Personal'
  const metadata = option.isDefault ? ' · Default' : option.isFavorite ? ' · Favorite' : ''
  return `${option.name} · ${scopeLabel}${metadata}`
}

export const resolveProjectCurrentOperator = (operatorsValue: unknown, currentUserId: unknown) => {
  if (!Array.isArray(operatorsValue) || typeof currentUserId !== 'string' || !currentUserId.trim()) return null
  const identity = currentUserId.trim()
  return operatorsValue.find((entry) => {
    const record = asRecord(entry)
    return record && (record.username === identity || record.external_id === identity)
  }) || null
}

export const resolveProjectCurrentTeamId = (operatorsValue: unknown, currentUserId: unknown): number | null => {
  if (!Array.isArray(operatorsValue) || typeof currentUserId !== 'string' || !currentUserId.trim()) {
    projectSavedViewTeamResolution = undefined
    return null
  }
  if (!operatorsValue.length) {
    projectSavedViewTeamResolution = undefined
    return null
  }
  const current = resolveProjectCurrentOperator(operatorsValue, currentUserId)
  const teamId = Number(asRecord(current)?.team_id)
  const resolved = Number.isSafeInteger(teamId) && teamId > 0 ? teamId : null
  projectSavedViewTeamResolution = resolved
  return resolved
}

export const projectSavedViewLinkedRemoteId = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export const buildProjectSavedViewIdentitySearch = (searchValue: unknown, remoteId?: number | null) => {
  const params = new URLSearchParams(typeof searchValue === 'string' ? searchValue : '')
  if (Number.isSafeInteger(remoteId) && Number(remoteId) > 0) params.set('saved_view', String(remoteId))
  else params.delete('saved_view')
  return params.toString()
}

const scheduleProjectSavedViewIdentity = (remoteId?: number | null, expectedCurrentRemoteId?: number | null) => {
  if (typeof window === 'undefined') return
  if (projectSavedViewIdentityTimer !== null) window.clearTimeout(projectSavedViewIdentityTimer)
  projectSavedViewIdentityTimer = window.setTimeout(() => {
    projectSavedViewIdentityTimer = null
    const current = new URLSearchParams(window.location.search)
    if (expectedCurrentRemoteId !== undefined
      && projectSavedViewLinkedRemoteId(current.get('saved_view')) !== expectedCurrentRemoteId) return
    const search = buildProjectSavedViewIdentitySearch(current.toString(), remoteId)
    const nextHref = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextHref === currentHref) return
    window.history.replaceState(window.history.state, '', nextHref)
    const event = typeof PopStateEvent === 'function'
      ? new PopStateEvent('popstate', { state: window.history.state })
      : new Event('popstate')
    window.dispatchEvent(event)
  }, 0)
}

export const buildProjectSavedViewShareSearch = (searchValue: unknown, remoteId: number) => (
  buildProjectSavedViewIdentitySearch(searchValue, remoteId)
)

export const projectSavedViewStateForSelection = (
  options: ProjectSavedViewOption[],
  id: string,
): ProjectSavedViewState | null => {
  const selected = options.find((option) => option.id === id)
  if (!selected) return null
  scheduleProjectSavedViewIdentity(selected.source === 'remote' ? selected.remoteId : null)
  let section = projectSavedViewSectionFromValue(selected.state)
  if (!section && selected.remoteId && typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    const linkedId = projectSavedViewLinkedRemoteId(params.get('saved_view'))
    const linkedSection = projectSavedViewSectionFromSearch(params.toString())
    const normalized = normalizeProjectSavedViewStateForSections(selected.state)
    if (linkedId === selected.remoteId && linkedSection && normalized.view === projectSavedViewTopLevelForSection(linkedSection)) section = linkedSection
  }
  return projectSavedViewStateWithSection(selected.state, section)
}

export const projectSavedViewStatesEqual = (left: unknown, right: unknown) => {
  const normalizedLeft = normalizeProjectSavedViewStateForSections(left)
  const normalizedRight = normalizeProjectSavedViewStateForSections(right)
  const leftSection = projectSavedViewSectionFromValue(left) || projectSavedViewDefaultSection(normalizedLeft)
  const currentSection = currentProjectSavedViewSection()
  const rightSection = projectSavedViewSectionFromValue(right)
    || (currentSection && normalizedRight.view === projectSavedViewTopLevelForSection(currentSection) ? currentSection : null)
    || projectSavedViewDefaultSection(normalizedRight)
  return JSON.stringify({ ...normalizedLeft, section: leftSection }) === JSON.stringify({ ...normalizedRight, section: rightSection })
}

export const buildProjectSavedViewMutationPayload = (
  nameValue: unknown,
  stateValue: unknown,
  revision?: number,
  scope: ProjectSavedViewScope = 'personal',
  teamId?: number | null,
) => {
  const name = normalizeProjectSavedViewName(nameValue)
  const normalizedTeamId = scope === 'team' && Number.isSafeInteger(teamId) && Number(teamId) > 0 ? Number(teamId) : null
  const definition: Record<string, unknown> = { ...projectSavedViewToWorkspaceDefinition(stateValue) }
  const normalizedState = normalizeProjectSavedViewStateForSections(stateValue)
  const currentSection = currentProjectSavedViewSection()
  const section = projectSavedViewSectionFromValue(stateValue)
    || (currentSection && normalizedState.view === projectSavedViewTopLevelForSection(currentSection) ? currentSection : null)
    || projectSavedViewDefaultSection(normalizedState)
  const filters = asRecord(definition.filters) || {}
  const watch = (Array.isArray(filters.watch) ? filters.watch : [])
    .filter((entry): entry is string => typeof entry === 'string' && !entry.startsWith(PROJECT_SAVED_VIEW_SECTION_FILTER_PREFIX))
  if (section && normalizedState.view === projectSavedViewTopLevelForSection(section)) watch.push(`${PROJECT_SAVED_VIEW_SECTION_FILTER_PREFIX}${section}`)
  definition.filters = { ...filters, watch }
  const payload: Record<string, unknown> = {
    name,
    scope,
    team_id: normalizedTeamId,
    definition,
    schema_version: 1,
  }
  if (Number.isSafeInteger(revision) && Number(revision) > 0) payload.revision = Number(revision)
  return payload
}

export const projectSavedViewConflictFromError = (error: unknown): ProjectSavedViewConflict | null => {
  const source = asRecord(error)
  if (Number(source?.status) !== 409) return null
  const data = asRecord(source?.data)
  const detail = data ? asRecord(data.detail) : null
  const currentRecord = detail ? asRecord(detail.current) : null
  const option = projectSavedViewOptionFromRemoteRecord(currentRecord)
  if (!option?.remoteId || !option.revision || !option.scope || !currentRecord) return null
  return {
    message: typeof detail?.message === 'string' && detail.message.trim()
      ? detail.message.trim()
      : 'Saved view changed on the server.',
    current: {
      ...currentRecord,
      id: option.remoteId,
      workspace_key: 'projects',
      name: option.name,
      scope: option.scope,
      team_id: option.scope === 'team' ? option.teamId || null : null,
      definition: asRecord(currentRecord.definition) || {},
      schema_version: 1,
      revision: option.revision,
    } as ProjectRemoteSavedViewRecord,
    option,
  }
}

export const projectSavedViewErrorMessage = (error: unknown): string => {
  const source = asRecord(error)
  const data = source ? asRecord(source.data) : null
  const detail = data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  const detailRecord = asRecord(detail)
  if (typeof detailRecord?.message === 'string' && detailRecord.message.trim()) return detailRecord.message.trim()
  if (typeof source?.message === 'string' && source.message.trim() && source.message !== '[object Object]') return source.message.trim()
  return 'Saved view request failed.'
}

/** The only server failure that is intentionally quiet for legacy saved-view capability discovery. */
export const isLegacySavedViewUnsupportedError = (error: unknown): boolean => {
  const source = asRecord(error)
  const status = Number(source?.status)
  const data = source ? asRecord(source.data) : null
  const detail = data?.detail
  const message = typeof detail === 'string' ? detail : asRecord(detail)?.message || source?.message
  return status === 404 && message === 'Saved views are not supported by this server.'
}

export const isProjectSavedViewOfflineError = (error: unknown) => {
  const source = asRecord(error)
  const status = Number(source?.status)
  return !Number.isFinite(status) || status === 0 || status >= 500
}

export const upsertProjectRemoteSavedViewPayload = (payloadValue: unknown, recordValue: unknown) => {
  const payload = asRecord(payloadValue)
  const views = payload && Array.isArray(payload.views) ? payload.views : []
  const option = projectSavedViewOptionFromRemoteRecord(recordValue)
  if (!option?.remoteId) return payloadValue
  scheduleProjectSavedViewIdentity(option.remoteId)
  return {
    ...(payload || {}),
    views: [recordValue, ...views.filter((row) => Number(asRecord(row)?.id) !== option.remoteId)].slice(0, MAX_PROJECT_SAVED_VIEW_OPTIONS),
  }
}

export const removeProjectRemoteSavedViewPayload = (payloadValue: unknown, remoteId: number) => {
  const payload = asRecord(payloadValue)
  const views = payload && Array.isArray(payload.views) ? payload.views : []
  scheduleProjectSavedViewIdentity(null, remoteId)
  return {
    ...(payload || {}),
    views: views.filter((row) => Number(asRecord(row)?.id) !== remoteId),
  }
}
