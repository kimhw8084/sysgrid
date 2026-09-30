import { useWorkspaceConfirmation } from './shared/useWorkspaceConfirmation'
import { useWorkspacePrompt } from './shared/useWorkspacePrompt'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, ChevronDown, CircleDot, Clock3, Filter, LayoutList, Milestone, Plus, RefreshCcw, Search, ShieldCheck, Sparkles, Target, Users } from 'lucide-react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  createPV1Draft,
  discardPV1Draft,
  promotePV1Draft,
  readCreationOperators,
  readCreationTeams,
  readPV1Portfolio,
  readPV1Project,
  readPV1ProjectSummary,
  readPV1Readiness,
  runPV1LifecycleCommand,
  savePV1CreationDraft,
  PortfolioProjectionError,
} from './ProjectsStory.api'
import {
  PROJECT_TEMPLATES,
  applyProjectTemplate,
  blankCreationDraft,
  homePrimaryAction,
  lifecycleMessage,
  projectBucket,
  projectUpdateText,
  sortPortfolioItems,
  type CreationDraft,
  type PortfolioSort,
  type ProjectStoryItem,
  type ProjectTemplate,
} from './ProjectsStory.model'
import './ProjectsPV1.css'
import './ProjectsStory.css'

const inputClass = 'p04-input'
const RECOVERY_KEY = 'sysgrid_projects_creation_recovery_v1'

const localUserId = () => typeof window === 'undefined' ? 'admin_root' : localStorage.getItem('SYSGRID_USER_ID') || localStorage.getItem('SYSGRID_CONFIG_DEFAULT_USER_ID') || 'admin_root'
const isoDate = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${value.slice(0, 10)}T12:00:00`)) : 'Not scheduled'
const relativeFreshness = (value?: string | null) => {
  if (!value) return 'Freshness unavailable'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Updated ${hours}h ago`
  return `Updated ${Math.floor(hours / 24)}d ago`
}
const ownerLabel = (operators: any[], ownerId?: string | null) => operators.find((operator) => operator.username === ownerId || operator.external_id === ownerId)?.full_name || ownerId || 'Unassigned'
const teamLabel = (teams: any[], teamId?: number | null) => teams.find((team) => Number(team.id) === Number(teamId))?.name || (teamId ? `Team ${teamId}` : 'No team')

function StoryState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <section className="sg-pv1-state p04-state" role="status"><h2>{title}</h2><p>{description}</p>{action}</section>
}

function ProjectPrimaryNavigation({ project }: { project: ProjectStoryItem }) {
  return <nav className="p04-project-nav" data-project-primary-nav="true" aria-label="Project primary navigation">{[
    ['home', 'Home'], ['work?layout=list', 'Work'], ['plan?section=brief', 'Plan'], ['timeline', 'Timeline'], ['updates?section=updates', 'Updates'], ['outcomes?section=summary', 'Outcomes'],
  ].map(([key, label]) => <Link key={key} to={`/projects/${encodeURIComponent(project.id)}/${key}`} aria-current={key.startsWith('home') ? 'page' : undefined}>{label}</Link>)}</nav>
}

const apiFailureDescription = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) return fallback
  const requestId = String((error as Error & { requestId?: string; data?: { request_id?: string } }).requestId || (error as Error & { data?: { request_id?: string } }).data?.request_id || '')
  return `${error.message || fallback}${requestId ? ` Request ID: ${requestId}.` : ''}`
}

function StoryShell({ children, active, project, projects = [], teams = [], teamId = '', onTeamChange, onRefresh, refreshing = false, showProjectNavigation = true, onProjectSelectorFocus }: { children: React.ReactNode; active: 'portfolio' | 'new' | 'home'; project?: ProjectStoryItem | null; projects?: ProjectStoryItem[]; teams?: any[]; teamId?: string; onTeamChange?: (value: string) => void; onRefresh?: () => void; refreshing?: boolean; showProjectNavigation?: boolean; onProjectSelectorFocus?: () => void }) {
  const navigate = useNavigate()
  const selectorProjects = project ? [project, ...projects.filter((item) => item.id !== project.id)] : projects
  return <div data-workspace="projects" data-pv1-projects-route="true" data-p04-projects-story="true" className="p04-page">
    <div className="p04-shell">
      <header className="p04-global-header">
        <div className="p04-brand"><span>Projects</span><nav aria-label="Projects global navigation"><Link to="/projects" aria-current={active === 'portfolio' ? 'page' : undefined}>Portfolio</Link><Link to="/projects/my-day">My day</Link></nav></div>
        <div className="p04-global-actions">
          {teams.length && onTeamChange ? <label className="p04-team-selector"><span>Team</span><select value={teamId} onChange={(event) => onTeamChange(event.target.value)}><option value="">All allowed teams</option>{teams.filter((team) => !team.is_archived).map((team) => <option key={team.id} value={String(team.id)}>{team.name}</option>)}</select></label> : null}
          {project ? <label className="p04-project-selector"><span>Project</span><select value={project.id} onFocus={onProjectSelectorFocus} onPointerDown={onProjectSelectorFocus} onChange={(event) => navigate(`/projects/${encodeURIComponent(event.target.value)}/home`)}>{selectorProjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
          {onRefresh ? <button className="p04-icon-button" type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh Projects"><RefreshCcw size={16} className={refreshing ? 'p04-spin' : ''} /></button> : null}
          <Link className="p04-button p04-button-primary" to="/projects/new"><Plus size={16} /> New project</Link>
        </div>
      </header>
      {project && showProjectNavigation ? <ProjectPrimaryNavigation project={project} /> : null}
      {children}
    </div>
  </div>
}

const summaryKeys = ['Planned', 'Active', 'Delivered', 'Paused', 'Cancelled', 'Needs attention', 'Measuring', 'Realized', 'Closed below target'] as const

function PortfolioScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const [portfolioSearchParams] = useSearchParams()
  const currentUserId = localUserId()
  const parentFocus = portfolioSearchParams.get('parent') || ''
  const [teamId, setTeamId] = useState('')
  const [search, setSearch] = useState('')
  const [phase, setPhase] = useState('All')
  const [health, setHealth] = useState('All')
  const [sort, setSort] = useState<PortfolioSort>('attention')
  const [mode, setMode] = useState<'table' | 'timeline'>('table')
  const [includeSubprojects, setIncludeSubprojects] = useState(Boolean(parentFocus))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const portfolio = useQuery({ queryKey: ['pv1-projects-portfolio', teamId], queryFn: () => readPV1Portfolio(teamId ? Number(teamId) : undefined), placeholderData: (previous) => previous, staleTime: 30_000 })
  const operators = useQuery({ queryKey: ['operators'], queryFn: readCreationOperators, staleTime: 60_000 })
  const teams = useQuery({ queryKey: ['teams'], queryFn: readCreationTeams, staleTime: 60_000 })
  const items = portfolio.data?.items || []
  const visible = useMemo(() => sortPortfolioItems(items.filter((project) => {
    if (!includeSubprojects && project.parent_project_id) return false
    if (parentFocus && project.id !== parentFocus && project.parent_project_id !== parentFocus) return false
    if (phase === 'Needs attention' && project.story.attention_count === 0) return false
    else if (phase === 'Measuring' && project.outcome_phase !== 'Measuring') return false
    else if (phase === 'Realized' && project.outcome_result !== 'Realized') return false
    else if (phase === 'Closed below target' && !(project.outcome_phase === 'Closed' && ['Partial', 'Not realized'].includes(project.outcome_result))) return false
    else if (!['All', 'Needs attention', 'Measuring', 'Realized', 'Closed below target'].includes(phase) && projectBucket(project) !== phase && project.phase !== phase) return false
    if (health !== 'All' && project.story.health.level !== health) return false
    const haystack = `${project.name} ${project.objective || ''} ${project.owner_id} ${project.display_key}`.toLowerCase()
    return haystack.includes(search.trim().toLowerCase())
  }), sort, currentUserId), [items, includeSubprojects, parentFocus, phase, health, search, sort, currentUserId])
  const activeTeams = (teams.data || []).filter((team: any) => !team.is_archived)
  const stalePortfolio = portfolio.isError && Boolean(portfolio.data)
  const invalidProjection = portfolio.error instanceof PortfolioProjectionError
  const portfolioNotice = (location.state as { projectsNotice?: string } | null)?.projectsNotice

  const toggleSelected = (projectId: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(projectId)) next.delete(projectId); else next.add(projectId)
    return next
  })

  return <StoryShell active="portfolio" teams={teams.data || []} teamId={teamId} onTeamChange={setTeamId} onRefresh={() => portfolio.refetch()} refreshing={portfolio.isFetching}>
    <main className="p04-stack" data-p04-portfolio="true">
      <section className="p04-page-heading"><div><p className="p04-eyebrow">Team portfolio</p><h1>Projects</h1><p>Delivery commitments, interventions, and outcome follow-up in one management-readable view.</p></div><span className="p04-freshness">{portfolio.data ? relativeFreshness(portfolio.data.as_of) : 'Loading projection…'}</span></section>
      {portfolioNotice ? <div className="p04-local-notice" role="status">{portfolioNotice}</div> : null}
      {invalidProjection ? <StoryState title="Portfolio unavailable" description={`Invalid project projection. ${apiFailureDescription(portfolio.error, 'The canonical Project response is incomplete; no projects were rendered.')}`} action={<button className="p04-button" onClick={() => portfolio.refetch()}>Retry</button>} /> : portfolio.isLoading && !portfolio.data ? <StoryState title="Loading Portfolio" description="Reading the canonical Project projection and rollups." /> : portfolio.isError && !portfolio.data ? <StoryState title="Portfolio unavailable" description={apiFailureDescription(portfolio.error, 'The project service did not return a usable response.')} action={<button className="p04-button" onClick={() => portfolio.refetch()}>Retry</button>} /> : <>
        {stalePortfolio ? <div className="p04-local-error" role="status">Showing stale cached project data. Refresh failed; editing availability may have changed. {apiFailureDescription(portfolio.error, '')}</div> : null}
        {portfolio.data?.coverage?.resources === 'partial' ? <div className="p04-local-notice"><strong>Some project data unavailable.</strong> Resource coverage is partial; delivery and outcome rollups remain current.</div> : null}
        <section className="p04-summary-strip" aria-label="Portfolio summary">{summaryKeys.map((key) => <button type="button" key={key} data-dimension={key === 'Needs attention' ? 'attention' : ['Measuring', 'Realized', 'Closed below target'].includes(key) ? 'outcome' : 'delivery'} aria-pressed={phase === key} onClick={() => { setPhase((current) => current === key ? 'All' : key); setHealth('All') }}><span>{key}</span><strong>{portfolio.data?.summary?.[key] ?? 0}</strong></button>)}</section>
        <section className="p04-toolbar" aria-label="Portfolio controls">
          <label className="p04-search"><Search size={16} /><span className="sr-only">Search projects</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects, objectives, owners…" /></label>
          <label><span className="sr-only">Filter by phase or outcome</span><select className={inputClass} value={phase} onChange={(event) => setPhase(event.target.value)}><option>All</option>{['Planned', 'Active', 'Delivered', 'Paused', 'Cancelled', 'Draft', 'Proposed', 'Planning', 'Ready', 'Executing', 'Validating', 'Needs attention', 'Measuring', 'Realized', 'Closed below target'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span className="sr-only">Filter by health</span><select className={inputClass} value={health} onChange={(event) => setHealth(event.target.value)}><option>All</option>{['Off track', 'At risk', 'Unknown', 'On track'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span className="sr-only">Sort projects</span><select className={inputClass} value={sort} onChange={(event) => setSort(event.target.value as PortfolioSort)}><option value="attention">Attention first</option><option value="target">Target date</option><option value="name">Project name</option></select></label>
          <label className="p04-check"><input type="checkbox" checked={includeSubprojects} onChange={(event) => setIncludeSubprojects(event.target.checked)} /> Include subprojects</label>
          <div className="p04-mode-switch"><button type="button" aria-pressed={mode === 'table'} onClick={() => setMode('table')}><LayoutList size={15} /> Table</button><button type="button" aria-pressed={mode === 'timeline'} onClick={() => setMode('timeline')}><CalendarDays size={15} /> Timeline</button></div>
        </section>
        {teams.isSuccess && !activeTeams.length ? <StoryState title="No accessible team" description="You do not currently have an active team available for project creation." action={<a className="p04-button" href="/settings?tab=teams">Request access</a>} /> : !items.length ? <StoryState title="No projects yet" description="Create the first project for this team. Drafts remain resumable and are included in Planned." action={<a className="p04-button p04-button-primary" href="/projects/new">New project</a>} /> : !visible.length ? <StoryState title="No matching projects" description="No project matches the current search and filters." action={<button className="p04-button" onClick={() => { setSearch(''); setPhase('All'); setHealth('All') }}>Clear filters</button>} /> : mode === 'table' ? <section className="p04-table-wrap" aria-label="Portfolio projects">
          <table className="p04-table"><thead><tr><th><span className="sr-only">Select</span></th><th>Project</th><th>Owner</th><th>Phase</th><th>Health</th><th>Delivery</th><th>Next milestone</th><th>Target</th><th>Outcomes</th></tr></thead><tbody>{visible.map((project) => <tr key={project.id} tabIndex={0} onDoubleClick={() => navigate(`/projects/${encodeURIComponent(project.id)}/home`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/projects/${encodeURIComponent(project.id)}/home`); if (event.key === ' ') { event.preventDefault(); toggleSelected(project.id) } }} data-health={project.story.health.level}>
            <td><input type="checkbox" aria-label={`Select ${project.name}`} checked={selected.has(project.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelected(project.id)} /></td>
            <td><a href={`/projects/${encodeURIComponent(project.id)}/home`}><strong>{project.name}</strong><span>{project.objective || 'Objective not recorded'}</span><small>{project.display_key}{project.parent_project_id ? ' · Subproject · direct scope' : project.child_count ? ' · Parent · direct scope' : ''}</small></a>{project.child_count ? <a className="p04-child-link" href={`/projects?parent=${encodeURIComponent(project.id)}`}>{project.child_count} subproject{project.child_count === 1 ? '' : 's'}</a> : null}</td>
            <td>{ownerLabel(operators.data || [], project.owner_id)}<small>{teamLabel(teams.data || [], project.team_id)}</small></td>
            <td><span className="p04-pill">{project.run_state === 'Active' ? project.phase : project.run_state}</span></td>
            <td><span className={`p04-health p04-health-${project.story.health.level.toLowerCase().replace(' ', '-')}`}>{project.story.health.level}</span><small>{project.story.health.reason}</small><small className="p04-row-freshness">{relativeFreshness(project.updated_at)}</small></td>
            <td><strong title={project.story.delivery.method} aria-describedby={`delivery-method-${project.id}`}>{project.story.delivery.label}</strong><small id={`delivery-method-${project.id}`}>{project.story.delivery.method}</small></td>
            <td>{project.story.next_milestone?.title || 'Not scheduled'}<small>{isoDate(project.story.next_milestone?.point_date || project.story.next_milestone?.end_date)}</small></td>
            <td>{project.target_date ? isoDate(project.target_date) : 'No target'}<small>{project.no_deadline_reason || 'Commitment date'}</small></td>
            <td>{project.outcome_phase}<small>{project.outcome_result}</small></td>
          </tr>)}</tbody></table>
        </section> : <PortfolioTimeline projects={visible} operators={operators.data || []} teams={teams.data || []} />}
        <PortfolioAttention projects={visible} />
      </>}
    </main>
  </StoryShell>
}

function PortfolioTimeline({ projects, operators, teams }: { projects: ProjectStoryItem[]; operators: any[]; teams: any[] }) {
  const [groupBy, setGroupBy] = useState<'team' | 'owner'>('team')
  const scheduled = projects.filter((project) => project.start_date && project.target_date)
  const unscheduled = projects.filter((project) => !project.start_date || !project.target_date)
  const timestamps = scheduled.flatMap((project) => [Date.parse(project.start_date!), Date.parse(project.target_date!)])
  const minimum = timestamps.length ? Math.min(...timestamps) : Date.now()
  const maximum = timestamps.length ? Math.max(...timestamps) : minimum + 86_400_000
  const span = Math.max(86_400_000, maximum - minimum)
  const grouped = new Map<string, ProjectStoryItem[]>()
  for (const project of scheduled) {
    const key = groupBy === 'owner' ? ownerLabel(operators, project.owner_id) : teamLabel(teams, project.team_id)
    grouped.set(key, [...(grouped.get(key) || []), project])
  }
  return <section className="p04-timeline" data-p04-portfolio-timeline="true"><header><div><h2>Portfolio timeline</h2><p>Read-only projection of top-level planned dates. Forecast extension appears only when a canonical forecast exists.</p></div><label>Group by <select className={inputClass} value={groupBy} onChange={(event) => setGroupBy(event.target.value as 'team' | 'owner')}><option value="team">Team</option><option value="owner">Owner</option></select></label></header>
    {[...grouped.entries()].map(([group, rows]) => <div className="p04-timeline-group" key={group}><h3>{group}</h3>{rows.map((project) => {
      const left = ((Date.parse(project.start_date!) - minimum) / span) * 100
      const width = Math.max(2, ((Date.parse(project.target_date!) - Date.parse(project.start_date!)) / span) * 100)
      return <a href={`/projects/${encodeURIComponent(project.id)}/home`} className="p04-timeline-row" key={project.id}><span>{project.name}</span><span className="p04-timeline-track"><i style={{ left: `${left}%`, width: `${width}%` }}><b>{project.story.delivery.label}</b></i>{project.story.next_milestone ? <em style={{ left: `${left + width}%` }} title={project.story.next_milestone.title} /> : null}</span><small>{isoDate(project.target_date)}</small></a>
    })}</div>)}
    {unscheduled.length ? <div className="p04-unscheduled"><h3>Unscheduled</h3>{unscheduled.map((project) => <a key={project.id} href={`/projects/${encodeURIComponent(project.id)}/home`}>{project.name}<span>Planned dates not recorded</span></a>)}</div> : null}
  </section>
}

function PortfolioAttention({ projects }: { projects: ProjectStoryItem[] }) {
  const rows = projects.flatMap((project) => project.story.attention.map((item) => ({ project, item })))
  const actionHref = (project: ProjectStoryItem, item: ProjectStoryItem['story']['attention'][number]) => {
    if (item.action === 'Open decision') return `/projects/${project.id}/plan?section=risks&panel=decision&entity=${item.entity_id}`
    if (item.action === 'Manage people') return `/projects/${project.id}/plan?section=people`
    if (item.action === 'Record measurement') return `/projects/${project.id}/outcomes?section=measurements${item.entity_id ? `&metric=${item.entity_id}` : ''}`
    if (item.action === 'Draft update') return `/projects/${project.id}/updates?section=draft`
    return `/projects/${project.id}/work${item.entity_id ? `?panel=task&entity=${item.entity_id}` : ''}`
  }
  return <section className="p04-attention" data-p04-attention="true"><header><div><p className="p04-eyebrow">Actionable attention</p><h2>Interventions</h2></div><span>{rows.length} open</span></header>{rows.length ? <div className="p04-attention-list">{rows.map(({ project, item }) => <article key={`${project.id}:${item.id}`}><span className="p04-attention-kind">{item.kind}</span><div><strong>{project.name}</strong><p>{item.reason}</p><small>Accountable: {item.accountable} · {item.due_date ? `Due ${isoDate(item.due_date)}` : 'No due date recorded'}</small></div><a className="p04-button" href={actionHref(project, item)}>{item.action}</a></article>)}</div> : <p className="p04-clear-state"><CheckCircle2 size={18} /> No intervention is currently recorded.</p>}</section>
}

function ProjectHomeScreen({ projectId }: { projectId: string }) {
  const { confirm: confirmWorkspace, confirmation } = useWorkspaceConfirmation()
  const { ask, promptDialog } = useWorkspacePrompt()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const summary = useQuery({ queryKey: ['pv1-project-summary', projectId], queryFn: () => readPV1ProjectSummary(projectId), staleTime: 60_000 })
  // The first Home viewport needs the current project's canonical summary;
  // the complete Portfolio projection is only needed when the selector is
  // opened.  Avoid competing with the summary request for a large graph and
  // keep the selector's fetch on the existing authorized query path.
  const portfolio = useQuery({ queryKey: ['pv1-projects-portfolio', ''], queryFn: () => readPV1Portfolio(), staleTime: 60_000, enabled: false })
  const teams = useQuery({ queryKey: ['teams'], queryFn: readCreationTeams, staleTime: 60_000 })
  const operators = useQuery({ queryKey: ['operators'], queryFn: readCreationOperators, staleTime: 60_000 })
  const project = summary.data?.project
  const story = summary.data?.story
  const loadProjectsForSelector = () => {
    if (!portfolio.data && !portfolio.isFetching) void portfolio.refetch()
  }
  const readiness = useQuery({ queryKey: ['pv1-project-readiness', projectId, 'Proposed'], queryFn: () => readPV1Readiness(projectId, 'Proposed'), enabled: project?.phase === 'Draft' && !project.archived_at, staleTime: 15_000 })
  const lifecycle = useMutation({ mutationFn: ({ type, payload }: { type: string; payload?: Record<string, unknown> }) => runPV1LifecycleCommand(project!, type, payload), onSuccess: (saved) => { queryClient.setQueryData(['pv1-project-summary', projectId], (current: any) => current ? { ...current, project: saved, story: saved.story, capabilities: saved.capabilities } : current); queryClient.invalidateQueries({ queryKey: ['pv1-projects-portfolio'] }) } })
  if (summary.isLoading && !summary.data) return <StoryShell active="home"><StoryState title="Loading Project Home" description="Reading the canonical management story." /></StoryShell>
  if (summary.isError || !project || !story) return <StoryShell active="home"><StoryState title="Project unavailable" description={apiFailureDescription(summary.error, 'The project is unavailable or you do not have access.')} action={<><button className="p04-button" onClick={() => summary.refetch()}>Retry</button><button className="p04-button" onClick={() => navigate('/projects')}>Back to Portfolio</button></>} /></StoryShell>
  const primary = homePrimaryAction(project)
  const banner = lifecycleMessage(project)
  const next = story.next_milestone
  const attention = story.attention[0]
  const metric = story.primary_metric
  const can = project.capabilities || {}
  const command = (type: string, payload: Record<string, unknown> = {}) => lifecycle.mutate({ type, payload })
  const pauseProject = async () => {
    const reason = await ask({ title: 'Pause project', label: 'Why is this project being paused?' })
    if (!reason) return
    const resumeReviewDate = await ask({ title: 'Pause project', label: 'Review date (optional)', type: 'date', optional: true })
    if (resumeReviewDate === null) return
    command('project.pause', { reason, ...(resumeReviewDate ? { resume_review_date: resumeReviewDate } : {}) })
  }
  const cancelProject = async () => {
    const reason = await ask({ title: 'Cancel project', label: 'Why is this project being cancelled? The record and history will be preserved.' })
    if (reason) command('project.cancel', { reason })
  }
  return <StoryShell active="home" project={project} projects={portfolio.data?.items || []} teams={teams.data || []} onProjectSelectorFocus={loadProjectsForSelector} onRefresh={() => summary.refetch()} refreshing={summary.isFetching} showProjectNavigation={false}>
    {confirmation}{promptDialog}
    <main className="p04-home" data-p04-project-home="true">
      {banner ? <div className={`p04-lifecycle-banner p04-lifecycle-${project.archived_at ? 'archived' : project.run_state.toLowerCase()}`}>{banner}</div> : null}
      <section className="p04-home-cover">
        <div className="p04-breadcrumb"><a href="/projects">Portfolio</a><span>/</span><span>{project.display_key}</span></div>
        <div className="p04-cover-row"><div><div className="p04-cover-kicker"><span>{project.archived_at ? 'Archived' : project.run_state === 'Active' ? project.phase : project.run_state}</span><span>{teamLabel(teams.data || [], project.team_id)}</span></div><h1>{project.name}</h1><p>{project.objective || 'Objective not recorded. Add the intended change before this project advances.'}</p><a href="#project-brief">Read brief</a></div><div className="p04-cover-actions"><a className="p04-button p04-button-primary" href={primary.href}>{primary.label}<ArrowRight size={16} /></a><details><summary className="p04-button">More <ChevronDown size={15} /></summary><div className="p04-menu">{can.edit ? <a href={`/projects/${project.id}/plan?section=brief`}>Edit project</a> : null}{can.manage_people ? <a href={`/projects/${project.id}/plan?section=people`}>Manage people</a> : null}<button onClick={() => navigator.clipboard?.writeText(window.location.href)}>Copy project link</button>{can.export ? <button onClick={() => window.print()}>Export summary</button> : null}{can.pause && project.run_state === 'Active' ? <button onClick={pauseProject}>Pause</button> : null}{can.pause && project.run_state === 'Paused' ? <button onClick={() => command('project.resume')}>Resume</button> : null}{can.cancel && project.run_state !== 'Cancelled' ? <button onClick={cancelProject}>Cancel</button> : null}{can.archive && (project.run_state === 'Cancelled' || (project.phase === 'Delivered' && project.outcome_result === 'Realized')) ? <button onClick={async () => { if (await confirmWorkspace({ title: 'Archive project?', message: 'It will leave the active Portfolio but remain recoverable.', confirmText: 'Archive', variant: 'warning' })) command('project.archive') }}>Archive</button> : null}{can.restore && project.archived_at ? <button onClick={() => command('project.restore')}>Restore</button> : null}</div></details></div></div>
        <div className="p04-property-band">{[
          ['Owner', ownerLabel(operators.data || [], project.owner_id)], ['Phase', project.run_state === 'Active' ? project.phase : project.run_state], ['Health', story.health.level], ['Priority', project.priority], ['Start → Target', `${project.start_date ? isoDate(project.start_date) : 'Not set'} → ${project.target_date ? isoDate(project.target_date) : 'Not set'}`],
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <a className="p04-delivery-line" href={`/projects/${project.id}/work?panel=delivery-explanation`}><span>Delivery</span><strong>{story.delivery.label}</strong><small>{story.delivery.method}</small></a>
      </section>
      <ProjectPrimaryNavigation project={project} />
      {project.phase === 'Draft' && !project.archived_at ? <section className="p04-readiness-strip" aria-label="Draft readiness"><div><p className="p04-eyebrow">Draft readiness</p><strong>{readiness.data?.ready ? 'Ready to create' : `${readiness.data?.gaps.length ?? '…'} required field${readiness.data?.gaps.length === 1 ? '' : 's'} remaining`}</strong></div><div>{readiness.data?.gaps.slice(0, 3).map((gap) => <a key={gap.code} href={`/projects/new?draft=${encodeURIComponent(project.id)}`}>{gap.message}</a>)}</div><a className="p04-button" href={`/projects/new?draft=${encodeURIComponent(project.id)}`}>Complete setup</a></section> : null}
      <section className="p04-now-success">
        <article><header><div><p className="p04-eyebrow">Now</p><h2>{project.run_state === 'Active' ? project.phase : project.run_state}</h2></div>{!project.archived_at && project.run_state === 'Active' ? <a href={`/projects/${project.id}/work`}>Open work</a> : <a href={`/projects/${project.id}/plan`}>View plan</a>}</header><a className="p04-story-fact" href={`/projects/${project.id}/timeline?panel=forecast-explanation`}><Milestone size={18} /><div><span>Next milestone</span><strong>{next?.title || 'No mandatory milestone recorded'}</strong><small>{next && (next.point_date || next.end_date) ? isoDate(next.point_date || next.end_date) : 'Forecast unavailable — schedule required work'}</small></div></a><div className={`p04-story-fact ${attention ? 'is-attention' : 'is-clear'}`}><AlertTriangle size={18} /><div><span>{attention ? attention.kind : 'Attention'}</span><strong>{attention?.reason || 'No immediate intervention'}</strong><small>{attention ? `Accountable: ${attention.accountable}` : 'No blocker or missed commitment is recorded.'}</small>{story.attention_count > 1 ? <a href={`/projects/${project.id}/plan?section=risks`}>View all {story.attention_count}</a> : null}</div></div></article>
        <article><header><div><p className="p04-eyebrow">Success</p><h2>{project.outcome_phase}</h2></div><a href={`/projects/${project.id}/outcomes`}>Open Outcomes</a></header><a className="p04-metric" href={`/projects/${project.id}/outcomes`}><Target size={18} /><div><span>{project.outcome_phase === 'Pilot' && metric?.current != null ? 'Pilot measurement · Primary metric' : 'Primary metric'}</span><strong>{metric?.name || 'Not measured'}</strong><p>{metric ? `${metric.current ?? 'Not measured'}${metric.unit ? ` ${metric.unit}` : ''} vs ${metric.target ?? 'target not set'}${metric.unit ? ` ${metric.unit}` : ''}` : 'Define a metric and steward before Ready.'}</p></div></a><div className="p04-success-meta"><span>Result <strong>{project.outcome_result}</strong></span><span>Next measurement <strong>{metric?.next_measurement_date ? isoDate(metric.next_measurement_date) : 'Not scheduled'}</strong></span></div></article>
      </section>
      <section className="p04-home-details" id="project-brief"><div className="p04-home-narrative"><article><p className="p04-eyebrow">Project brief</p><h2>The management story</h2><dl><div><dt>Problem</dt><dd>{project.problem || 'Not recorded'}</dd></div><div><dt>Objective</dt><dd>{project.objective || 'Not recorded'}</dd></div><div><dt>In scope</dt><dd>{project.in_scope || 'Not recorded'}</dd></div><div><dt>Out of scope</dt><dd>{project.out_of_scope || 'Not recorded'}</dd></div><div><dt>Delivery acceptance</dt><dd>{story.acceptance_criteria.length ? <ul>{story.acceptance_criteria.map((criterion) => <li key={criterion.id}>{criterion.description}</li>)}</ul> : 'No acceptance criteria recorded'}</dd></div></dl></article><article><p className="p04-eyebrow">Risks & decisions</p><h2>Unresolved management items</h2>{story.governance.length ? story.governance.map((item) => <a className="p04-governance-row" key={item.id} href={`/projects/${project.id}/plan?section=risks&panel=${item.type.toLowerCase()}&entity=${item.id}`}><span>{item.type}</span><strong>{item.title}</strong><small>{item.state}</small></a>) : <p className="p04-empty-copy">No unresolved risk or decision is recorded.</p>}</article><details className="p04-activity"><summary>View activity</summary><p>Open Updates for the auditable event stream and published project history.</p></details></div>
        <aside className="p04-home-support"><article><p className="p04-eyebrow">Milestones</p><h2>Next three</h2>{story.milestones.length ? story.milestones.map((item) => <a key={item.id} href={`/projects/${project.id}/timeline?panel=milestone&entity=${item.id}`}><strong>{item.title}</strong><span>{item.point_date || item.end_date ? isoDate(item.point_date || item.end_date) : 'Not scheduled'}</span></a>) : <p className="p04-empty-copy">No scheduled milestone.</p>}</article><article><p className="p04-eyebrow">Latest published update</p><h2>{story.latest_update?.published_at ? isoDate(story.latest_update.published_at) : 'No published update'}</h2><p>{projectUpdateText(story.latest_update)}</p><a href={`/projects/${project.id}/updates`}>Open Updates</a></article><article><p className="p04-eyebrow">Key resources</p><h2>Authorized and pinned</h2>{story.resources.length ? story.resources.slice(0, 4).map((item, index) => <a href={item.url || '#'} key={item.id || index}>{item.title || item.name || 'Project resource'}</a>) : <p className="p04-empty-copy">Resource service unavailable — no links are inferred.</p>}</article>{['Yes', 'Not assessed'].includes(story.architecture.assessment) ? <article><p className="p04-eyebrow">Architecture impact</p><h2>{story.architecture.assessment}</h2><p>{story.architecture.rationale || (story.architecture.assessment === 'Not assessed' ? 'Assessment required before Ready.' : 'No rationale recorded.')}</p><a href={`/projects/${project.id}/plan?panel=architecture`}>Open Architecture</a></article> : null}</aside></section>
      {lifecycle.error ? <div className="p04-local-error" role="alert">{apiFailureDescription(lifecycle.error, 'Lifecycle action failed.')}</div> : null}
    </main>
  </StoryShell>
}

type CreationForm = {
  name: string; objective: string; problem: string; owner_id: string; team_id: string; priority: string; in_scope: string; out_of_scope: string; target_date: string; no_deadline_reason: string; architecture_assessment: 'Yes' | 'No' | 'Not assessed'; architecture_rationale: string
}
type Recovery = { form: CreationForm; creation: CreationDraft; draftId: string | null; createCommandId: string; templateKey: string | null; updatedAt: string }
const defaultForm = (ownerId: string): CreationForm => ({ name: '', objective: '', problem: '', owner_id: ownerId, team_id: '', priority: 'Medium', in_scope: '', out_of_scope: '', target_date: '', no_deadline_reason: '', architecture_assessment: 'Not assessed', architecture_rationale: '' })
const readRecovery = (): Recovery | null => {
  if (typeof window === 'undefined') return null
  try { const value = JSON.parse(localStorage.getItem(RECOVERY_KEY) || 'null'); return value && value.form && value.creation ? value : null } catch { return null }
}

function NewProjectScreen() {
  const { confirm: confirmWorkspace, confirmation } = useWorkspaceConfirmation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const userId = localUserId()
  const initialRecovery = useRef(readRecovery())
  const [form, setForm] = useState<CreationForm>(() => initialRecovery.current?.form || defaultForm(userId))
  const [creation, setCreation] = useState<CreationDraft>(() => initialRecovery.current?.creation || blankCreationDraft(userId))
  const [templateKey, setTemplateKey] = useState<string | null>(() => searchParams.get('template') || initialRecovery.current?.templateKey || null)
  const [step, setStep] = useState(() => initialRecovery.current?.creation?.draft_step || 0)
  const [project, setProject] = useState<ProjectStoryItem | null>(null)
  const [saveState, setSaveState] = useState<'Not saved' | 'Saving' | 'Saved' | 'Save failed'>('Not saved')
  const [saveError, setSaveError] = useState('')
  const [transitionGaps, setTransitionGaps] = useState<Array<{ code: string; message: string; action: string }>>([])
  const createCommandId = useRef(initialRecovery.current?.createCommandId || crypto.randomUUID())
  const requestedDraftId = searchParams.get('draft') || initialRecovery.current?.draftId || ''
  const serverDraft = useQuery({ queryKey: ['pv1-project-draft', requestedDraftId], queryFn: () => readPV1Project(requestedDraftId), enabled: Boolean(requestedDraftId), retry: 1 })
  const teams = useQuery({ queryKey: ['teams'], queryFn: readCreationTeams, staleTime: 60_000 })
  const operators = useQuery({ queryKey: ['operators'], queryFn: readCreationOperators, staleTime: 60_000 })
  const hydrated = useRef(false)

  useEffect(() => {
    if (hydrated.current || !serverDraft.data) return
    const saved = serverDraft.data
    const draft = saved.creation_draft || blankCreationDraft(saved.owner_id)
    setProject(saved); setForm({ name: saved.name, objective: saved.objective || '', problem: saved.problem || '', owner_id: saved.owner_id, team_id: saved.team_id ? String(saved.team_id) : '', priority: saved.priority, in_scope: saved.in_scope || '', out_of_scope: saved.out_of_scope || '', target_date: saved.target_date || '', no_deadline_reason: saved.no_deadline_reason || '', architecture_assessment: saved.architecture_assessment || 'Not assessed', architecture_rationale: saved.architecture_rationale || '' }); setCreation(draft); setStep(draft.draft_step || 0); setTemplateKey(saved.template_key || null); setSaveState('Saved'); hydrated.current = true
  }, [serverDraft.data])

  useEffect(() => {
    if (form.team_id || !operators.data?.length) return
    const current = operators.data.find((operator: any) => operator.username === userId || operator.external_id === userId)
    if (current?.team_id) setForm((value) => ({ ...value, team_id: String(current.team_id) }))
  }, [operators.data, form.team_id, userId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const recovery: Recovery = { form, creation: { ...creation, draft_step: step }, draftId: project?.id || requestedDraftId || null, createCommandId: createCommandId.current, templateKey, updatedAt: new Date().toISOString() }
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(recovery))
    if (saveState === 'Saved') setSaveState('Not saved')
  }, [form, creation, step, templateKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTemplate = PROJECT_TEMPLATES.find((template) => template.key === templateKey) || null
  const activeTeams = (teams.data || []).filter((team: any) => !team.is_archived)
  const activeOperators = (operators.data || []).filter((operator: any) => !form.team_id || String(operator.team_id) === form.team_id || operator.username === form.owner_id || operator.external_id === form.owner_id)
  const setField = (field: keyof CreationForm, value: string) => setForm((current) => ({ ...current, [field]: value }))
  const creationWithStep = (nextStep: number) => ({ ...creation, draft_step: nextStep })

  const persist = async (draftValue: CreationDraft = creationWithStep(step)): Promise<ProjectStoryItem> => {
    setSaveState('Saving'); setSaveError('')
    try {
      if (!form.name.trim()) throw new Error('Add a project name before saving the server Draft.')
      if (!form.team_id) throw new Error('Select an allowed team before saving the server Draft.')
      let current = project
      if (!current) {
        current = await createPV1Draft({ name: form.name.trim(), team_id: Number(form.team_id), owner_id: form.owner_id || userId, objective: form.objective.trim() || null, problem: form.problem.trim() || null, priority: form.priority, template_key: selectedTemplate?.key || null, template_version: selectedTemplate?.version || null }, createCommandId.current)
        setProject(current)
        navigate(`/projects/new?draft=${encodeURIComponent(current.id)}`, { replace: true })
      }
      const saved = await savePV1CreationDraft(current, { name: form.name.trim(), objective: form.objective.trim() || null, problem: form.problem.trim() || null, in_scope: form.in_scope.trim() || null, out_of_scope: form.out_of_scope.trim() || null, priority: form.priority, target_date: form.target_date || null, no_deadline_reason: form.no_deadline_reason.trim() || null, architecture_assessment: form.architecture_assessment, architecture_rationale: form.architecture_rationale.trim() || null, template_key: selectedTemplate?.key || null, template_version: selectedTemplate?.version || null }, draftValue)
      setProject(saved); setCreation(draftValue); setSaveState('Saved')
      localStorage.setItem(RECOVERY_KEY, JSON.stringify({ form, creation: draftValue, draftId: saved.id, createCommandId: createCommandId.current, templateKey, updatedAt: new Date().toISOString() }))
      queryClient.invalidateQueries({ queryKey: ['pv1-projects-portfolio'] })
      return saved
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Draft save failed.'
      setSaveState('Save failed'); setSaveError(message); throw error
    }
  }

  const move = async (nextStep: number) => {
    const nextCreation = creationWithStep(nextStep)
    try { await persist(nextCreation); setStep(nextStep); setTransitionGaps([]) } catch { /* form and recovery remain in place */ }
  }
  const applyTemplate = (template: ProjectTemplate | null) => {
    if (!template) { setTemplateKey(null); setCreation(blankCreationDraft(form.owner_id || userId)); return }
    setTemplateKey(template.key); setCreation(applyProjectTemplate(creation, template, form.owner_id || userId))
  }
  const createProject = async () => {
    try {
      const saved = await persist(creationWithStep(3))
      const readiness = await readPV1Readiness(saved.id, 'Proposed')
      if (!readiness.ready) { setTransitionGaps(readiness.gaps); return }
      const promoted = await promotePV1Draft(saved)
      localStorage.removeItem(RECOVERY_KEY)
      queryClient.invalidateQueries({ queryKey: ['pv1-projects-portfolio'] })
      navigate(`/projects/${encodeURIComponent(promoted.id)}/home`)
    } catch { /* visible save/readiness error owns recovery */ }
  }
  const close = async () => {
    if (!form.name.trim() || !form.team_id) { navigate('/projects'); return }
    try {
      await persist(creationWithStep(step))
      navigate('/projects', { state: { projectsNotice: 'Draft saved' } })
    } catch { /* failed save remains visible with local recovery and blocks a false Draft saved message */ }
  }
  const discard = async () => {
    if (!await confirmWorkspace({ title: 'Discard draft?', message: 'Its audit record is preserved, but it will leave the active Portfolio.', confirmText: 'Discard draft', variant: 'danger' })) return
    try { if (project) await discardPV1Draft(project); localStorage.removeItem(RECOVERY_KEY); queryClient.invalidateQueries({ queryKey: ['pv1-projects-portfolio'] }); navigate('/projects') } catch (error) { setSaveState('Save failed'); setSaveError(error instanceof Error ? error.message : 'Draft discard failed.') }
  }

  const steps = ['Purpose', 'Success', 'Delivery plan', 'Review']
  return <StoryShell active="new" teams={activeTeams} teamId={form.team_id} onTeamChange={(value) => setField('team_id', value)}>
    {confirmation}
    <main className="p04-create" data-p04-new-project="true">
      <header className="p04-create-header"><div><p className="p04-eyebrow">New project</p><h1>Build a meaningful project story</h1><p>Four guided steps. Suggested content remains editable; dates, targets, and return are never invented.</p></div><div className={`p04-save-state is-${saveState.toLowerCase().replace(' ', '-')}`}><CircleDot size={14} /> {saveState}{project ? ` · ${project.display_key}` : ''}</div></header>
      {serverDraft.isError ? <div className="p04-local-error">Saved Draft unavailable. Your authorized local recovery remains loaded. <button onClick={() => serverDraft.refetch()}>Retry</button></div> : null}
      {saveError ? <div className="p04-local-error" role="alert">{saveError} Your entries are retained; no success was recorded.</div> : null}
      <ol className="p04-steps">{steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={index < step ? 'is-complete' : ''}><span>{index < step ? <CheckCircle2 size={16} /> : index + 1}</span><strong>{label}</strong></li>)}</ol>
      <div className="p04-create-layout"><section className="p04-step-card">
        {step === 0 ? <PurposeStep form={form} setField={setField} templates={PROJECT_TEMPLATES} selectedTemplate={selectedTemplate} applyTemplate={applyTemplate} teams={activeTeams} operators={activeOperators} /> : null}
        {step === 1 ? <SuccessStep creation={creation} setCreation={setCreation} operators={activeOperators} selectedTemplate={selectedTemplate} /> : null}
        {step === 2 ? <DeliveryStep form={form} setField={setField} creation={creation} setCreation={setCreation} operators={activeOperators} selectedTemplate={selectedTemplate} /> : null}
        {step === 3 ? <ReviewStep form={form} creation={creation} project={project} gaps={transitionGaps} onGap={(action) => setStep(action.includes('purpose') ? 0 : action.includes('success') ? 1 : 2)} /> : null}
        <footer className="p04-create-footer"><div>{step > 0 ? <button className="p04-button" onClick={() => move(step - 1)}>Back</button> : null}<button className="p04-button" onClick={close} disabled={saveState === 'Saving'}>Close</button><button className="p04-button p04-danger-button" onClick={discard}>Discard</button></div><div>{step < 3 ? <button className="p04-button p04-button-primary" onClick={() => move(step + 1)} disabled={saveState === 'Saving'}>Next <ArrowRight size={16} /></button> : <><button className="p04-button" onClick={() => persist(creationWithStep(3))}>Save draft</button><button className="p04-button p04-button-primary" onClick={createProject} disabled={saveState === 'Saving'}>Create project</button></>}</div></footer>
      </section><aside className="p04-guidance"><ShieldCheck size={22} /><h2>Truthful by default</h2><p>The server creates one versioned Draft and checks every transition. Suggested milestones and metric units become data only after you apply and save them.</p><dl><div><dt>Owner</dt><dd>{ownerLabel(operators.data || [], form.owner_id)}</dd></div><div><dt>Team</dt><dd>{teamLabel(teams.data || [], Number(form.team_id))}</dd></div><div><dt>Lifecycle</dt><dd>Draft → Proposed</dd></div><div><dt>Visibility</dt><dd>Team</dd></div></dl></aside></div>
    </main>
  </StoryShell>
}

function PurposeStep({ form, setField, templates, selectedTemplate, applyTemplate, teams, operators }: any) {
  return <div data-p04-step="purpose"><p className="p04-eyebrow">Step 1 · Purpose</p><h2>What problem are we solving?</h2><p className="p04-step-intro"><strong>What will change?</strong> Describe the observable difference this project should make.</p><div className="p04-field-grid"><label className="is-wide"><span>Project name <b>Required</b></span><input className={inputClass} maxLength={120} value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="Qualification Analysis Automation" /></label><label className="is-wide"><span>Objective <b>Required to create</b></span><textarea className={inputClass} maxLength={500} value={form.objective} onChange={(event) => setField('objective', event.target.value)} placeholder="Describe the management-readable change, not the task list." /></label><label className="is-wide"><span>Problem/context</span><textarea className={inputClass} value={form.problem} onChange={(event) => setField('problem', event.target.value)} placeholder="What is happening today, and why does it matter?" /></label><label><span>Owner</span><select className={inputClass} value={form.owner_id} onChange={(event) => setField('owner_id', event.target.value)}>{operators.map((operator: any) => <option key={operator.id} value={operator.username}>{operator.full_name || operator.username}</option>)}</select></label><label><span>Team</span><select className={inputClass} value={form.team_id} onChange={(event) => setField('team_id', event.target.value)}><option value="">Select an allowed team</option>{teams.map((team: any) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label><span>Priority</span><select className={inputClass} value={form.priority} onChange={(event) => setField('priority', event.target.value)}>{['Low', 'Medium', 'High', 'Critical'].map((value) => <option key={value}>{value}</option>)}</select></label></div><div className="p04-template-picker"><header><div><p className="p04-eyebrow">Optional template</p><h3>Editable suggestions, version 1.0.0</h3></div>{selectedTemplate ? <button className="p04-button" onClick={() => applyTemplate(null)}>Use blank</button> : null}</header><div>{templates.map((template: ProjectTemplate) => <button key={template.key} type="button" aria-pressed={selectedTemplate?.key === template.key} onClick={() => applyTemplate(template)}><Sparkles size={15} /><strong>{template.name}</strong><span>{template.milestones.length} suggested milestones</span></button>)}</div></div></div>
}

function SuccessStep({ creation, setCreation, operators, selectedTemplate }: { creation: CreationDraft; setCreation: React.Dispatch<React.SetStateAction<CreationDraft>>; operators: any[]; selectedTemplate: ProjectTemplate | null }) {
  const metric = creation.metric
  return <div data-p04-step="success"><p className="p04-eyebrow">Step 2 · Success</p><h2>What will be true when delivery is done?</h2><p className="p04-step-intro"><strong>How will we know it helped?</strong> Define acceptance separately from the result the project hopes to achieve.</p>{selectedTemplate && creation.suggestions_accepted ? <div className="p04-suggestion-label"><Sparkles size={15} /> Suggested by {selectedTemplate.name} · accepted and editable</div> : null}<div className="p04-field-grid"><label className="is-wide"><span>Delivery acceptance checklist</span><textarea className={inputClass} value={creation.acceptance_criteria.join('\n')} onChange={(event) => setCreation((current) => ({ ...current, acceptance_criteria: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) }))} placeholder={'One criterion per line\nEvidence is reviewed before delivery acceptance'} /></label><label className="is-wide"><span>Primary metric</span><input className={inputClass} value={metric.name} onChange={(event) => setCreation((current) => ({ ...current, metric: { ...current.metric, name: event.target.value } }))} placeholder="What observable change will be measured?" /></label><label><span>Unit</span><input className={inputClass} value={metric.unit} onChange={(event) => setCreation((current) => ({ ...current, metric: { ...current.metric, unit: event.target.value } }))} placeholder="%, hours, incidents…" /></label><label><span>Steward</span><select className={inputClass} value={metric.steward_id} onChange={(event) => setCreation((current) => ({ ...current, metric: { ...current.metric, steward_id: event.target.value } }))}><option value="">Select steward</option>{operators.map((operator: any) => <option key={operator.id} value={operator.username}>{operator.full_name || operator.username}</option>)}</select></label><label className="is-wide"><span>Measurement definition</span><textarea className={inputClass} value={metric.measurement_method} onChange={(event) => setCreation((current) => ({ ...current, metric: { ...current.metric, measurement_method: event.target.value } }))} placeholder="Population, source, cadence, and how the observation is verified." /></label></div><div className="p04-local-notice">Numeric targets remain blank until an accountable person enters an agreed value. Applying a template never invents one.</div></div>
}

function DeliveryStep({ form, setField, creation, setCreation, operators, selectedTemplate }: any) {
  return <div data-p04-step="delivery"><p className="p04-eyebrow">Step 3 · Delivery plan</p><h2>What must happen next?</h2><p className="p04-step-intro">Dates, owners, dependencies, and architecture impact remain explicit.</p>{selectedTemplate && creation.suggestions_accepted ? <div className="p04-suggestion-label"><Sparkles size={15} /> Suggested by {selectedTemplate.name} · accepted and editable</div> : null}<div className="p04-field-grid"><label><span>Target date</span><input type="date" className={inputClass} value={form.target_date} onChange={(event) => setField('target_date', event.target.value)} /></label><label><span>No external deadline rationale</span><input className={inputClass} value={form.no_deadline_reason} onChange={(event) => setField('no_deadline_reason', event.target.value)} placeholder="Required if no target before Ready" /></label><label className="is-wide"><span>Milestones</span><textarea className={inputClass} value={creation.milestones.map((item: any) => item.title).join('\n')} onChange={(event) => setCreation((current: CreationDraft) => ({ ...current, milestones: event.target.value.split('\n').map((title) => title.trim()).filter(Boolean).map((title) => ({ title, owner_id: form.owner_id || null, point_date: null })) }))} placeholder={'One milestone per line\nNo dates are inferred'} /></label><label className="is-wide"><span>Collaborators</span><input className={inputClass} value={creation.collaborators.join(', ')} onChange={(event) => setCreation((current: CreationDraft) => ({ ...current, collaborators: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) }))} placeholder="Add accountable collaborators" /></label><label className="is-wide"><span>Dependencies</span><textarea className={inputClass} value={creation.dependencies.join('\n')} onChange={(event) => setCreation((current: CreationDraft) => ({ ...current, dependencies: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) }))} placeholder="One known dependency per line" /></label><label><span>Architecture impact</span><select className={inputClass} value={form.architecture_assessment} onChange={(event) => setField('architecture_assessment', event.target.value)}><option>Not assessed</option><option>Yes</option><option>No</option></select></label><label><span>Architecture rationale</span><input className={inputClass} value={form.architecture_rationale} onChange={(event) => setField('architecture_rationale', event.target.value)} placeholder={form.architecture_assessment === 'No' ? 'Required before Ready' : 'Assessment context'} /></label><label className="is-wide"><span>In scope</span><textarea className={inputClass} value={form.in_scope} onChange={(event) => setField('in_scope', event.target.value)} /></label><label className="is-wide"><span>Out of scope</span><textarea className={inputClass} value={form.out_of_scope} onChange={(event) => setField('out_of_scope', event.target.value)} /></label></div>{creation.milestones.length ? <div className="p04-milestone-owners"><h3>Milestone ownership</h3>{creation.milestones.map((milestone: any, index: number) => <label key={`${milestone.title}:${index}`}><span>{milestone.title}</span><select className={inputClass} value={milestone.owner_id || ''} onChange={(event) => setCreation((current: CreationDraft) => ({ ...current, milestones: current.milestones.map((item, itemIndex) => itemIndex === index ? { ...item, owner_id: event.target.value || null } : item) }))}><option value="">Owner required before Ready</option>{operators.map((operator: any) => <option key={operator.id} value={operator.username}>{operator.full_name || operator.username}</option>)}</select></label>)}</div> : null}</div>
}

function ReviewStep({ form, creation, project, gaps, onGap }: { form: CreationForm; creation: CreationDraft; project: ProjectStoryItem | null; gaps: Array<{ code: string; message: string; action: string }>; onGap: (action: string) => void }) {
  return <div data-p04-step="review"><p className="p04-eyebrow">Step 4 · Review</p><h2>Review the Project Home story</h2><p className="p04-step-intro">Create moves this Draft to Proposed. Later transition gaps remain visible and actionable; there is no readiness score.</p><div className="p04-review-story"><div><span>Project</span><strong>{form.name || 'Name required'}</strong><p>{form.objective || 'Objective required to create'}</p></div><dl><div><dt>Owner</dt><dd>{form.owner_id || 'Required'}</dd></div><div><dt>Priority</dt><dd>{form.priority}</dd></div><div><dt>Target</dt><dd>{form.target_date || form.no_deadline_reason || 'Not recorded'}</dd></div><div><dt>Architecture</dt><dd>{form.architecture_assessment}</dd></div><div><dt>Acceptance</dt><dd>{creation.acceptance_criteria.length} criteria</dd></div><div><dt>Milestones</dt><dd>{creation.milestones.length}</dd></div><div><dt>Metric</dt><dd>{creation.metric.name || 'Not defined'}</dd></div><div><dt>Server Draft</dt><dd>{project?.display_key || 'Will save on Create'}</dd></div></dl></div>{gaps.length ? <section className="p04-readiness-gaps"><h3>Transition gaps</h3>{gaps.map((gap) => <button key={gap.code} onClick={() => onGap(gap.action)}><AlertTriangle size={16} /><span><strong>{gap.message}</strong><small>{gap.action}</small></span></button>)}</section> : <div className="p04-local-notice">Create will ask the server to verify Draft → Proposed. Name, owner, and objective are required; no later-stage facts are invented.</div>}</div>
}

export function shouldUseProjectsStory(pathname: string, search = ''): { kind: 'portfolio' | 'new' | 'home'; projectId?: string } | null {
  if (pathname === '/projects' || pathname === '/projects/') {
    if (new URLSearchParams(search).has('id')) return null
    return { kind: 'portfolio' }
  }
  if (pathname === '/projects/new' || pathname === '/projects/new/') return { kind: 'new' }
  const match = pathname.match(/^\/projects\/([^/]+)\/home\/?$/)
  return match ? { kind: 'home', projectId: decodeURIComponent(match[1]) } : null
}

export default function ProjectsStory() {
  const location = useLocation()
  const route = shouldUseProjectsStory(location.pathname, location.search)
  if (!route) return null
  if (route.kind === 'portfolio') return <PortfolioScreen />
  if (route.kind === 'new') return <NewProjectScreen />
  return <ProjectHomeScreen projectId={route.projectId!} />
}
