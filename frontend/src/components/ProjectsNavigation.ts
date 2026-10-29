export type ProjectsDestination = 'home' | 'work' | 'plan' | 'timeline' | 'updates' | 'outcomes'
export type ProjectsPortfolioDestination = 'portfolio' | 'my-day' | 'new'
export type ProjectsPanel = 'task' | 'risk' | 'decision' | 'resource' | 'measurement' | 'architecture'
export type ProjectsRouteSource = 'canonical' | 'legacy' | 'not-found'

export const PROJECTS_CANONICAL_DESTINATIONS: readonly ProjectsDestination[] = [
  'home', 'work', 'plan', 'timeline', 'updates', 'outcomes',
]
export const PROJECTS_CANONICAL_NAV = [
  { key: 'home', label: 'Home' },
  { key: 'work', label: 'Work' },
  { key: 'plan', label: 'Plan' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'updates', label: 'Updates' },
  { key: 'outcomes', label: 'Outcomes' },
] as const

const WORK_LAYOUTS = ['list', 'board'] as const
const PLAN_SECTIONS = ['brief', 'milestones', 'architecture', 'risks', 'resources'] as const
const UPDATE_SECTIONS = ['updates', 'activity', 'reports'] as const
const OUTCOME_SECTIONS = ['summary', 'measurements', 'value'] as const
const ARCHITECTURE_MODES = ['current', 'impact', 'proposed'] as const

export type ProjectsRoute = {
  source: ProjectsRouteSource
  kind: ProjectsDestination | ProjectsPortfolioDestination
  projectId: string | null
  section: string | null
  layout: 'list' | 'board' | null
  panel: ProjectsPanel | null
  entityId: string | null
  architectureMode: 'current' | 'impact' | 'proposed' | null
  changeset: string | null
  redirectTo: string | null
  legacyView: 'overview' | 'tasks' | 'timeline' | 'board' | 'files' | 'updates' | 'reports' | 'insights' | 'portfolio'
}

const asSearchParams = (search: string | URLSearchParams | undefined) => search instanceof URLSearchParams ? search : new URLSearchParams(search || '')
export const shouldPreserveLegacyProjectsPortfolioLocation = (pathname: string, search?: string | URLSearchParams) => {
  if (pathname !== '/projects' && pathname !== '/projects/') return false
  const params = asSearchParams(search)
  const view = (params.get('view') || '').toLowerCase()
  if (params.has('id')) return params.get('legacy_workspace') === '1' && ['overview', 'tasks', 'timeline', 'board', 'files', 'updates', 'reports', 'insights'].includes(view)
  if (params.has('saved_view')) return true
  const section = (params.get('section') || '').toLowerCase()
  return view === 'overview' || Boolean(section && section !== 'control')
}

export const buildProjectsLegacyWorkspacePath = (legacyProjectId: number | string, view: ProjectsRoute['legacyView'], section?: string) => {
  const params = new URLSearchParams({ view, id: String(legacyProjectId), legacy_workspace: '1' })
  if (section) params.set('section', section)
  return `/projects?${params.toString()}`
}
const isNonEmpty = (value: string | null): value is string => Boolean(value && value.trim())
const valid = <T extends string>(value: string | null, values: readonly T[], fallback: T): T => value && (values as readonly string[]).includes(value) ? value as T : fallback

const parseLegacy = (params: URLSearchParams, projectId: string | null): ProjectsRoute => {
  const raw = (params.get('view') || '').toLowerCase()
  if (!projectId && (!raw || raw === 'portfolio' || raw === 'roadmap' || raw === 'owners')) {
    const route = baseRoute('legacy', 'portfolio', null, null, null, null, null, null, 'portfolio')
    route.redirectTo = buildProjectsLegacyRedirect(params, route)
    return route
  }
  let route: ProjectsRoute
  if (raw === 'tasks') route = baseRoute('legacy', 'work', projectId, null, 'list', null, null, null, 'tasks')
  else if (raw === 'board') route = baseRoute('legacy', 'work', projectId, null, 'board', null, null, null, 'board')
  else if (raw === 'timeline') route = baseRoute('legacy', 'timeline', projectId, null, null, null, null, null, 'timeline')
  else if (raw === 'files') route = baseRoute('legacy', 'plan', projectId, 'resources', null, null, null, null, 'files')
  else if (raw === 'updates') {
    const section = valid(params.get('section'), UPDATE_SECTIONS, 'updates')
    route = baseRoute('legacy', 'updates', projectId, section, null, null, null, null, 'updates')
  }
  else if (raw === 'reports') route = baseRoute('legacy', 'updates', projectId, 'reports', null, null, null, null, 'reports')
  else if (raw === 'insights' || raw === 'review' || raw === 'governance') {
    const requestedSection = params.get('section')?.toLowerCase()
    if (raw === 'governance' || requestedSection === 'governance') {
      route = baseRoute('legacy', 'outcomes', projectId, 'governance', null, null, null, null, 'insights')
    } else if (OUTCOME_SECTIONS.includes(requestedSection as typeof OUTCOME_SECTIONS[number])) {
      route = baseRoute('legacy', 'outcomes', projectId, requestedSection!, null, null, null, null, 'insights')
    } else {
      // "review" was a legacy-only screen and has no canonical Plan section.
      // Resolve it to the nearest durable planning destination instead of
      // emitting /plan?section=review (which rendered an empty panel).
      const section = valid(requestedSection, ['review', 'brief', 'architecture', 'risks'] as const, 'brief')
      route = baseRoute('legacy', 'plan', projectId, section, null, null, null, null, 'insights')
    }
  }
  else route = baseRoute('legacy', projectId ? 'home' : 'portfolio', projectId, null, null, null, null, null, projectId ? 'overview' : 'portfolio')
  route.redirectTo = buildProjectsLegacyRedirect(params, route)
  return route
}

const baseRoute = (
  source: ProjectsRouteSource,
  kind: ProjectsRoute['kind'],
  projectId: string | null,
  section: string | null,
  layout: ProjectsRoute['layout'],
  panel: ProjectsPanel | null,
  entityId: string | null,
  architectureMode: ProjectsRoute['architectureMode'],
  legacyView: ProjectsRoute['legacyView'],
  changeset: string | null = null,
): ProjectsRoute => ({ source, kind, projectId, section, layout, panel, entityId, architectureMode, changeset, redirectTo: null, legacyView })

export const parseProjectsLocation = (pathname: string, search?: string | URLSearchParams): ProjectsRoute => {
  const embeddedQueryIndex = pathname.indexOf('?')
  const params = asSearchParams(search || (embeddedQueryIndex >= 0 ? pathname.slice(embeddedQueryIndex + 1) : ''))
  const cleanPathname = embeddedQueryIndex >= 0 ? pathname.slice(0, embeddedQueryIndex) : pathname
  const segments = cleanPathname.replace(/\/+$/, '').split('/').filter(Boolean)
  if (segments[0] !== 'projects') return baseRoute('not-found', 'portfolio', null, null, null, null, null, null, 'portfolio')
  if (segments.length === 1) {
    const hasLegacyQuery = ['view', 'id', 'task', 'report', 'showcase'].some((key) => params.has(key))
    return hasLegacyQuery ? parseLegacy(params, isNonEmpty(params.get('id')) ? params.get('id') : null) : baseRoute('canonical', 'portfolio', null, null, null, null, null, null, 'portfolio')
  }
  if (segments.length === 2 && segments[1] === 'my-day') return baseRoute('canonical', 'my-day', null, null, null, null, null, null, 'portfolio')
  if (segments.length === 2 && segments[1] === 'new') return baseRoute('canonical', 'new', null, null, null, null, null, null, 'portfolio')
  const projectId = segments[1]
  if (!isNonEmpty(projectId)) return baseRoute('not-found', 'portfolio', null, null, null, null, null, null, 'portfolio')
  if (segments.length === 2) {
    const route = baseRoute('canonical', 'home', projectId, null, null, null, null, null, 'overview')
    route.redirectTo = buildProjectsDestinationPath(projectId, 'home')
    return route
  }
  const destination = segments[2] as ProjectsDestination
  if (!(PROJECTS_CANONICAL_DESTINATIONS as readonly string[]).includes(destination)) return baseRoute('not-found', 'home', projectId, null, null, null, null, null, 'overview')
  const panelValue = params.get('panel')
  const panel = (['task', 'risk', 'decision', 'resource', 'measurement', 'architecture'] as readonly string[]).includes(panelValue || '') ? panelValue as ProjectsPanel : null
  const entityId = panel && isNonEmpty(params.get('entity')) ? params.get('entity') : null
  const layout = destination === 'work' ? valid(params.get('layout'), WORK_LAYOUTS, 'list') : null
  const section = destination === 'plan' ? valid(params.get('section'), PLAN_SECTIONS, 'brief') : destination === 'updates' ? valid(params.get('section'), UPDATE_SECTIONS, 'updates') : destination === 'outcomes' ? valid(params.get('section'), OUTCOME_SECTIONS, 'summary') : null
  const architectureMode = destination === 'plan' && section === 'architecture' ? valid(params.get('mode'), ARCHITECTURE_MODES, 'current') : null
  const legacyView = destination === 'work' ? layout === 'board' ? 'board' : 'tasks' : destination === 'plan' ? section === 'resources' ? 'files' : section === 'milestones' ? 'timeline' : ['brief', 'architecture', 'risks'].includes(section || '') ? 'insights' : 'overview' : destination === 'updates' ? section === 'reports' ? 'reports' : 'updates' : destination === 'outcomes' ? 'insights' : destination === 'timeline' ? 'timeline' : 'overview'
  return baseRoute('canonical', destination, projectId, section, layout, panel, entityId, architectureMode, legacyView, isNonEmpty(params.get('changeset')) ? params.get('changeset') : null)
}

export const buildProjectsDestinationPath = (projectId: string | number, destination: ProjectsDestination = 'home', options: { layout?: 'list' | 'board'; section?: string; panel?: ProjectsPanel; entityId?: string | number; mode?: ProjectsRoute['architectureMode']; changeset?: string } = {}) => {
  const params = new URLSearchParams()
  if (destination === 'work') params.set('layout', options.layout || 'list')
  if (destination === 'plan') params.set('section', options.section || 'brief')
  if (destination === 'updates') params.set('section', options.section || 'updates')
  if (destination === 'outcomes') params.set('section', options.section || 'summary')
  if (options.panel) { params.set('panel', options.panel); if (options.entityId != null) params.set('entity', String(options.entityId)) }
  if (options.mode && destination === 'plan' && options.section === 'architecture') params.set('mode', options.mode)
  if (options.changeset) params.set('changeset', options.changeset)
  const query = params.toString()
  return `/projects/${encodeURIComponent(String(projectId))}/${destination}${query ? `?${query}` : ''}`
}

export const projectRouteForLegacyView = (projectId: string | number, view: ProjectsRoute['legacyView'], section?: string) => {
  if (view === 'portfolio') return '/projects'
  if (view === 'tasks') return buildProjectsDestinationPath(projectId, 'work', { layout: 'list' })
  if (view === 'board') return buildProjectsDestinationPath(projectId, 'work', { layout: 'board' })
  if (view === 'timeline') return buildProjectsDestinationPath(projectId, 'timeline')
  if (view === 'files') return buildProjectsDestinationPath(projectId, 'plan', { section: 'resources' })
  if (view === 'updates') return buildProjectsDestinationPath(projectId, 'updates', { section: UPDATE_SECTIONS.includes(section as typeof UPDATE_SECTIONS[number]) ? section : 'updates' })
  if (view === 'reports') return buildProjectsDestinationPath(projectId, 'updates', { section: 'reports' })
  if (view === 'insights') {
    if (OUTCOME_SECTIONS.includes(section as typeof OUTCOME_SECTIONS[number])) return buildProjectsDestinationPath(projectId, 'outcomes', { section })
    const planSection = section === 'review' || section === 'risks' ? 'risks' : section === 'architecture' ? 'architecture' : 'brief'
    return buildProjectsDestinationPath(projectId, 'plan', { section: planSection })
  }
  return buildProjectsDestinationPath(projectId, 'home')
}

export const buildProjectsLegacyRedirect = (params: URLSearchParams, route: ProjectsRoute): string => {
  const legacyView = (params.get('view') || '').toLowerCase()
  const projectId = params.get('id')
  let path = !projectId
    ? '/projects'
    : legacyView === 'governance' || route.section === 'governance'
      ? buildProjectsDestinationPath(projectId, 'plan', { section: 'risks' })
      : legacyView === 'insights' && route.section === 'review'
        ? buildProjectsDestinationPath(projectId, 'plan', { section: 'brief' })
      : route.kind === 'outcomes'
        ? buildProjectsDestinationPath(projectId, 'outcomes', { section: route.section || 'summary' })
        : projectRouteForLegacyView(projectId, route.legacyView, route.section || undefined)
  const retained = new URLSearchParams()
  const taskId = params.get('task')
  const reportId = params.get('report')
  const savedViewId = params.get('saved_view')
  const showcase = params.get('showcase')
  if (taskId && projectId && route.kind === 'work') {
    path = buildProjectsDestinationPath(projectId, 'work', { layout: route.layout || 'list', panel: 'task', entityId: taskId })
  } else if (taskId && projectId && route.kind === 'home') {
    path = buildProjectsDestinationPath(projectId, 'home', { panel: 'task', entityId: taskId })
  }
  if (!projectId && (legacyView === 'roadmap' || legacyView === 'owners')) retained.set('section', legacyView)
  if (reportId) retained.set('report', reportId)
  if (savedViewId) retained.set('saved_view', savedViewId)
  if (showcase) retained.set('showcase', showcase)
  const query = retained.toString()
  return path + (query ? (path.includes('?') ? '&' : '?') + query : '')
}

export const canonicalQueryKeys = (route: ProjectsRoute): string[] => {
  if (route.source !== 'canonical') return ['view', 'id', 'task', 'report', 'showcase', 'saved_view']
  if (route.kind === 'new') return ['template', 'draft']
  return ['layout', 'section', 'panel', 'entity', 'mode', 'changeset', 'task', 'report', 'showcase', 'saved_view']
}
