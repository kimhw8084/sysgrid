import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, History, Megaphone, Plus, RefreshCcw, ShieldCheck } from 'lucide-react'
import { apiFetch } from '../api/apiClient'
import { ProjectsOfflineNotice, useProjectsOnline } from './ProjectsState'
import { ProjectsLegacyWorkspaceRedirect, ProjectsPrimaryNavigation } from './ProjectsRouteChrome'
import './ProjectsCommunication.css'
import './ProjectsCommunicationTheme.css'

type CommunicationRoute = 'updates' | 'activity' | 'resources' | 'reports'

export function shouldUseProjectsCommunication(pathname: string, search = ''): { projectId: string; route: CommunicationRoute } | null {
  const match = pathname.match(/^\/projects\/([^/]+)\/(updates|resources|reports)\/?$/)
  if (!match) return null
  const requestedSection = new URLSearchParams(search).get('section')
  const queryRoute = match[2] === 'updates' && requestedSection === 'reports' ? 'reports' : match[2] === 'updates' && requestedSection === 'activity' ? 'activity' : match[2]
  return { projectId: decodeURIComponent(match[1]), route: queryRoute as CommunicationRoute }
}

const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const jsonOrThrow = async (response: Response) => { if (!response.ok) throw new Error(await response.text()); return response.json() }

function command(projectId: string, type: string, expected: Record<string, unknown>, payload: Record<string, unknown>) {
  const commandId = uuid()
  return apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId }, body: JSON.stringify({ command_id: commandId, type, expected, payload }) }).then(jsonOrThrow)
}

function Header({ projectId, active, project }: { projectId: string; active: CommunicationRoute; project?: any }) {
  const primaryActive = active === 'resources' ? 'plan' : 'updates'
  const extras = [
    { label: 'Updates', href: `/projects/${encodeURIComponent(projectId)}/updates`, active: active === 'updates' },
    { label: 'Activity', href: `/projects/${encodeURIComponent(projectId)}/updates?section=activity`, active: active === 'activity' },
    { label: 'Resources', href: `/projects/${encodeURIComponent(projectId)}/resources`, active: active === 'resources' },
    { label: 'Reports', href: `/projects/${encodeURIComponent(projectId)}/reports`, active: active === 'reports' },
  ]
  return <header className="p08-header"><div><p className="p05-eyebrow">Projects · evidence communication</p><h1>{active === 'updates' ? 'Updates' : active === 'activity' ? 'Activity' : active === 'resources' ? 'Resources' : 'Reports'}</h1>{project ? <p className="p08-project-context"><strong>{project.display_key}</strong> · {project.name}</p> : <p className="p08-project-context">Project {projectId}</p>}</div><ProjectsPrimaryNavigation projectId={projectId} active={primaryActive} legacyProjectId={project?.legacy_project_id} extras={extras} /></header>
}

function State({ message, error = false }: { message: string; error?: boolean }) { return <p className={error ? 'p08-error' : 'p08-state'} role={error ? 'alert' : undefined}>{message}</p> }

function UpdatesView({ projectId, project, refresh }: { projectId: string; project: any; refresh: () => void }) {
  const [commentary, setCommentary] = useState('')
  const [draftDirty, setDraftDirty] = useState(false)
  const commentaryRevision = useRef(0)
  const query = useQuery({ queryKey: ['p08-updates', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/updates?history=true`).then(jsonOrThrow) })
  const draft = useMemo(() => (query.data?.items || []).find((item: any) => item.state === 'Draft'), [query.data])
  const create = useMutation({ mutationFn: () => { const id = uuid(); return apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/updates/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify({ period_start: new Date().getFullYear() + '-01-01', period_end: new Date().getFullYear() + '-12-31' }) }).then(jsonOrThrow) }, onSuccess: refresh })
  const save = useMutation({ mutationFn: (variables: { commentary: string; revision: number }) => command(projectId, 'update.autosave', { project_revision: project.revision }, { draft_id: draft.id, content: { ...(draft.content || {}), commentary: variables.commentary }, health_assessment: draft.health_assessment || undefined }), onSuccess: (_result, variables) => { if (commentaryRevision.current === variables.revision) setDraftDirty(false); refresh() } })
  const publish = useMutation({ mutationFn: () => command(projectId, 'update.publish', { project_revision: project.revision }, { update_id: draft.id }), onSuccess: refresh })
  useEffect(() => { commentaryRevision.current += 1; setCommentary(draft?.content?.commentary || ''); setDraftDirty(false) }, [draft?.id])
  useEffect(() => {
    if (!draft || !draftDirty || save.isPending) return
    const revision = commentaryRevision.current
    const value = commentary
    const timer = window.setTimeout(() => save.mutate({ commentary: value, revision }), 800)
    return () => window.clearTimeout(timer)
  }, [commentary, draftDirty, draft?.id, save.isPending])
  if (query.isPending) return <State message="Loading persisted updates…" />
  if (query.isError) return <section className="p08-card"><State error message="Project history could not be loaded." /><button className="p05-button" onClick={refresh}>Retry</button></section>
  return <div className="p08-grid" data-project-updates-only="true"><section className="p08-card p08-draft" aria-labelledby="draft-title"><div className="p08-card-heading"><div><p className="p05-eyebrow">AI disabled by default</p><h2 id="draft-title">Deterministic draft</h2><p>Facts come from persisted project events and carry their source revisions. A human always publishes.</p></div><button className="p05-button" onClick={() => create.mutate()} disabled={create.isPending}><Plus size={16} /> Draft from facts</button></div>{create.isError || save.isError || publish.isError ? <State error message="The update change could not be saved. Your current draft remains available; retry the action." /> : save.isSuccess && !draftDirty ? <p className="p08-success" role="status">Draft saved.</p> : publish.isSuccess ? <p className="p08-success" role="status">Update published.</p> : null}{draft ? <><dl className="p08-meta"><div><dt>Period</dt><dd>{draft.period_start} → {draft.period_end}</dd></div><div><dt>Source revision</dt><dd>{draft.source_revisions?.project_revision || 'Unknown'}</dd></div><div><dt>Computed health</dt><dd>{draft.content?.computed_health?.level || 'Unknown'}</dd></div></dl><div className="p08-fact-sections">{Object.entries(draft.content?.sections || {}).map(([section, values]: [string, any]) => <section key={section}><h3>{section}</h3><ul>{(values || []).map((item: any, index: number) => <li key={`${section}-${index}`}>{item.text}<small>Source: {(item.source_ids || []).join(', ') || 'none'}</small></li>)}</ul></section>)}</div><label className="p08-editor"><span>Human commentary {draftDirty ? save.isPending ? '· saving…' : '· unsaved changes' : ''}</span><textarea value={commentary} onChange={(event) => { commentaryRevision.current += 1; setCommentary(event.target.value); setDraftDirty(true) }} placeholder="Optional narrative; it does not change persisted facts." /></label><div className="p08-actions"><button className="p05-button" onClick={() => save.mutate({ commentary, revision: commentaryRevision.current })} disabled={save.isPending || !draftDirty}>Save draft</button><button className="p05-button p08-primary" onClick={() => publish.mutate()} disabled={publish.isPending || draftDirty || save.isPending}>Publish update</button></div></> : <State message="No draft exists. Generate one from persisted facts to begin." />}</section><section className="p08-card" aria-labelledby="history-title"><div className="p08-card-heading"><div><p className="p05-eyebrow">Immutable history</p><h2 id="history-title"><History size={18} /> Published updates</h2></div><button className="p08-icon" aria-label="Refresh updates" onClick={refresh}><RefreshCcw size={16} /></button></div>{(query.data?.items || []).filter((item: any) => item.state !== 'Draft').map((item: any) => <article className="p08-history-row" key={item.id}><strong>{item.content?.title || 'Project update'}</strong><span>{item.state} · {item.published_at || item.withdrawn_at || 'Not published'}</span><small>Source project revision {item.source_revisions?.project_revision || 'unknown'} · later edits do not rewrite this snapshot.</small></article>)}{!(query.data?.items || []).some((item: any) => item.state !== 'Draft') ? <State message="No published update yet." /> : null}</section></div>
}

function ActivityView({ projectId }: { projectId: string }) {
  const activity = useQuery({ queryKey: ['p08-activity', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/activity?limit=100`).then(jsonOrThrow) })
  return <section className="p08-card" aria-labelledby="activity-title" data-project-activity-view="true"><div className="p08-card-heading"><div><p className="p05-eyebrow">Durable project evidence</p><h2 id="activity-title"><History size={18} /> Activity</h2><p>System recorded changes and their actors, shown separately from human project updates.</p></div><button className="p08-icon" aria-label="Refresh activity" onClick={() => activity.refetch()} disabled={activity.isFetching}><RefreshCcw size={16} /></button></div>{activity.isPending ? <State message="Loading activity…" /> : activity.isError ? <><State error message="Activity could not be loaded." /><button className="p05-button" onClick={() => activity.refetch()}>Retry</button></> : activity.data?.items?.length ? <div className="p08-activity-list">{activity.data.items.map((item: any) => <article className="p08-history-row" key={item.id}><strong>{item.summary || item.action || 'Project activity'}</strong><span>{item.category || item.event_type || 'Recorded'} · {item.actor_id || 'System'} · {item.timestamp || item.created_at}</span>{item.detail ? <small>{item.detail}</small> : null}</article>)}</div> : <State message="No system activity has been recorded for this project yet." />}</section>
}

function ResourcesView({ projectId, project, refresh }: { projectId: string; project: any; refresh: () => void }) {
  const location = useLocation()
  const titleRef = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('General note')
  const [content, setContent] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [upload, setUpload] = useState<Record<string, unknown> | null>(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [resourceError, setResourceError] = useState('')
  const resourcePath = `/projects/${encodeURIComponent(projectId)}/resources`
  const selectedResourceId = new URLSearchParams(location.search).get('resource') || ''
  const query = useQuery({ queryKey: ['p08-resources', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/resources`).then(jsonOrThrow) })
  const versions = useQuery({ queryKey: ['p08-resource-versions', projectId, selectedResourceId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(selectedResourceId)}/versions`).then(jsonOrThrow), enabled: Boolean(selectedResourceId) })
  const selectedResource = (query.data?.items || []).find((item: any) => item.id === selectedResourceId)
  const normalizedExternalUrl = (() => {
    try {
      const parsed = new URL(externalUrl.trim())
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''
    } catch { return '' }
  })()
  const save = useMutation({
    mutationFn: () => command(projectId, 'resource.save', { project_revision: project.revision }, { title: title.trim(), resource_kind: upload ? 'Uploaded file' : kind, content: kind === 'External link' && !upload ? normalizedExternalUrl : content, external_url: kind === 'External link' && !upload ? normalizedExternalUrl : undefined, upload: upload || undefined, pinned: false }),
    onSuccess: () => { setTitle(''); setContent(''); setExternalUrl(''); setUpload(null); setResourceError(''); if (fileInput.current) fileInput.current.value = ''; refresh() },
  })
  const chooseFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 25 * 1024 * 1024) { setUpload(null); setResourceError('Files must be 25 MB or smaller.'); event.target.value = ''; return }
    setResourceError('')
    setUploadingFile(true)
    const reader = new FileReader()
    reader.onload = () => { setUpload({ filename: file.name, mime_type: file.type || 'text/plain', size_bytes: file.size, content_base64: String(reader.result).split(',')[1] || '' }); setUploadingFile(false) }
    reader.onerror = () => { setUpload(null); setUploadingFile(false); setResourceError('The selected file could not be read. Choose it again or add a link instead.'); event.target.value = '' }
    reader.readAsDataURL(file)
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setResourceError('')
    if (!title.trim()) { setResourceError('Add a resource title.'); titleRef.current?.focus(); return }
    if (kind === 'External link' && !normalizedExternalUrl) { setResourceError('Enter a complete http or https URL.'); return }
    save.mutate()
  }
  if (query.isPending) return <State message="Loading authorized resources…" />
  if (query.isError) return <section className="p08-card"><State error message="Project resources could not be loaded." /><button className="p05-button" onClick={refresh}>Retry</button></section>
  return <div className="p08-grid">
    <section className="p08-card" aria-labelledby="resource-add-title"><p className="p05-eyebrow">Project library</p><h2 id="resource-add-title">Add a native resource</h2><p>Markdown is sanitized on the server. Files remain Pending until a clean scan is recorded.</p><form className="p08-resource-form" data-project-ui-form="true" onSubmit={submit}>
      <label>Title<input ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></label>
      <label>Type<select value={kind} onChange={(event) => { setKind(event.target.value); setResourceError(''); if (event.target.value === 'External link') { setUpload(null); if (fileInput.current) fileInput.current.value = '' } }}><option>General note</option><option>Brief supplement</option><option>Specification</option><option>Runbook</option><option>Test evidence</option><option>Design decision</option><option>External link</option></select></label>
      {kind === 'External link' ? <label>External URL<input type="url" value={externalUrl} onChange={(event) => { setExternalUrl(event.target.value); setResourceError('') }} placeholder="https://example.com/resource" maxLength={2048} required /><small>Use a complete http or https address.</small></label> : <label>Sanitized content<textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write Markdown; executable markup is rejected." /></label>}
      {kind !== 'External link' ? <label>Optional file<input ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg,.svg,.txt,.md,.csv" disabled={uploadingFile || save.isPending} onChange={chooseFile} />{uploadingFile ? <small>Reading file…</small> : upload ? <small>Selected file will enter Pending scanning.</small> : null}</label> : null}
      <button className="p05-button p08-primary" type="submit" disabled={save.isPending || uploadingFile || !title.trim() || (kind === 'External link' && !normalizedExternalUrl)}><Plus size={16} /> {uploadingFile ? 'Reading file…' : save.isPending ? 'Saving…' : 'Save resource'}</button>
      {resourceError ? <State error message={resourceError} /> : save.isError ? <State error message="Resource could not be saved. Retry after checking the title and service status." /> : save.isSuccess ? <p className="p08-success" role="status">Resource saved.</p> : null}
    </form></section>
    {selectedResourceId ? <section className="p08-card" aria-labelledby="resource-history-title" data-project-resource-history="true"><div className="p08-card-heading"><div><p className="p05-eyebrow">Immutable revisions</p><h2 id="resource-history-title">{selectedResource?.title || 'Resource version history'}</h2><p>Current version {selectedResource?.revision ?? 'unknown'} · {selectedResource?.scan_state || 'resource unavailable'}</p></div><Link className="p08-back" to={resourcePath}>All resources</Link></div>{versions.isPending ? <State message="Loading resource history…" /> : versions.isError ? <><State error message="Resource history could not be loaded." /><button className="p05-button" onClick={() => versions.refetch()} disabled={versions.isFetching}>Retry</button></> : (versions.data?.items || []).map((version: any) => <article className="p08-resource-row" key={version.id}><div><strong>{version.title}</strong><span>Version {version.version} · {version.scan_state} · {version.created_at}</span></div><small>{version.mime_type || 'Text resource'}{version.size_bytes ? ` · ${Math.ceil(version.size_bytes / 1024)} KB` : ''} · {version.created_by || 'System'}</small><p>{version.content || (version.scan_state === 'Pending' ? 'File scanning is in progress.' : 'No inline content in this version.')}</p></article>)}</section> : <section className="p08-card" aria-labelledby="resource-list-title"><div className="p08-card-heading"><div><p className="p05-eyebrow">Authorized library</p><h2 id="resource-list-title"><FileText size={18} /> Resources</h2></div><div className="p08-export-links"><a href={`/api/v2/projects/${encodeURIComponent(projectId)}/resources/export?format=markdown`}>Markdown</a><a href={`/api/v2/projects/${encodeURIComponent(projectId)}/resources/export?format=csv`}>CSV</a><a href={`/api/v2/projects/${encodeURIComponent(projectId)}/resources/export?format=json`}>JSON</a></div></div>{(query.data?.items || []).map((item: any) => <article className="p08-resource-row" key={item.id}><div><strong>{item.title}</strong><span>{item.resource_kind} · revision {item.revision}</span></div><small><ShieldCheck size={14} /> {item.scan_state} · {item.pinned ? 'Pinned' : 'Not pinned'}</small><p>{item.content || (item.scan_state === 'Pending' ? 'File scanning is in progress.' : 'No inline content.')}</p><Link to={`${resourcePath}?resource=${encodeURIComponent(item.id)}`}>View version history</Link></article>)}{!(query.data?.items || []).length ? <State message="No authorized resources yet." /> : null}</section>}
  </div>
}
function ReportsView({ projectId, project }: { projectId: string; project: any }) {
  const queryClient = useQueryClient()
  const reports = useQuery({ queryKey: ['p08-reports', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/reports`).then(jsonOrThrow) })
  const capture = useMutation({ mutationFn: (report_type: string) => { const id = uuid(); return apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/reports/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify({ report_type, period_start: new Date().getFullYear() + '-01-01', period_end: new Date().getFullYear() + '-12-31' }) }).then(jsonOrThrow) }, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['p08-reports', projectId] }) })
  if (reports.isPending) return <section className="p08-card"><State message="Loading report snapshots…" /></section>
  if (reports.isError) return <section className="p08-card"><State error message="Report snapshots could not be loaded." /><button className="p05-button" onClick={() => queryClient.invalidateQueries({ queryKey: ['p08-reports', projectId] })}>Retry</button></section>
  return <section className="p08-card" aria-labelledby="reports-title"><div className="p08-card-heading"><div><p className="p05-eyebrow">Immutable snapshots</p><h2 id="reports-title"><Megaphone size={18} /> Reports from canonical state</h2><p>Reports include source revisions, access labels, and a creation time. They never edit project truth.</p></div></div><div className="p08-report-actions">{['Stakeholder summary', 'Delivery acceptance', 'Outcome review'].map((type) => <button className="p05-button" key={type} onClick={() => capture.mutate(type)} disabled={capture.isPending}>Capture {type}</button>)}</div>{capture.isError ? <State error message="The report snapshot could not be captured. Try again." /> : capture.isSuccess ? <p className="p08-success" role="status">Report snapshot captured.</p> : null}<div className="p08-report-list">{(reports.data?.items || []).map((report: any) => <article key={report.id}><strong>{report.report_type}</strong><span>Revision {report.project_revision} · {report.created_at}</span><a href={`/api/v2/projects/${encodeURIComponent(projectId)}/reports/${report.id}/export?format=html`}>HTML</a><a href={`/api/v2/projects/${encodeURIComponent(projectId)}/reports/${report.id}/export?format=pdf`}>PDF</a><a href={`/api/v2/projects/${encodeURIComponent(projectId)}/reports/${report.id}/export?format=json`}>JSON</a></article>)}{!(reports.data?.items || []).length ? <State message="No report snapshots captured yet." /> : null}</div></section>
}

export default function ProjectsCommunication() {
  const location = useLocation()
  const navigate = useNavigate()
  const route = shouldUseProjectsCommunication(location.pathname, location.search)
  const projectId = route?.projectId || ''
  const project = useQuery({ queryKey: ['pv1-project-route', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}`).then(jsonOrThrow), enabled: Boolean(projectId), staleTime: 30_000 })
  const queryClient = useQueryClient()
  const online = useProjectsOnline()
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['pv1-project-route', projectId] }); queryClient.invalidateQueries({ queryKey: ['p08-updates', projectId] }); queryClient.invalidateQueries({ queryKey: ['p08-activity', projectId] }); queryClient.invalidateQueries({ queryKey: ['p08-resources', projectId] }); queryClient.invalidateQueries({ queryKey: ['p08-reports', projectId] }) }
  if (!route) return null
  if (project.isPending) return <main className="p08-page" data-workspace="projects" data-pv1-projects-route="true" data-p08-communication="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} active={route.route} /><State message="Loading project communication…" /></main>
  if (project.isError) return <main className="p08-page" data-workspace="projects" data-pv1-projects-route="true" data-p08-communication="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} active={route.route} /><State error message="Project communication could not be loaded." /><button className="p05-button" onClick={() => project.refetch()}>Retry</button></main>
  if (project.data?.legacy_project_id != null) return <main className="p08-page" data-workspace="projects" data-pv1-projects-route="true" data-p08-communication="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} active={route.route} project={project.data} /><ProjectsLegacyWorkspaceRedirect project={project.data} view={route.route === 'resources' ? 'files' : route.route === 'activity' ? 'updates' : route.route} section={route.route === 'activity' ? 'activity' : undefined} /></main>
  return <main className="p08-page" data-workspace="projects" data-pv1-projects-route="true" data-p08-communication="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} active={route.route} project={project.data} />{route.route === 'updates' ? <UpdatesView projectId={projectId} project={project.data} refresh={refresh} /> : route.route === 'activity' ? <ActivityView projectId={projectId} /> : route.route === 'resources' ? <ResourcesView projectId={projectId} project={project.data} refresh={refresh} /> : <ReportsView projectId={projectId} project={project.data} />}<button className="p08-back" onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}/home`)}>Back to Project Home</button></main>
}
