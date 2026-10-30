import React, { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ClipboardCheck, CircleDollarSign, LockKeyhole, RotateCcw, Target } from 'lucide-react'
import { apiFetch } from '../api/apiClient'
import { ProjectsOfflineNotice, useProjectsOnline } from './ProjectsState'
import { ProjectsLegacyWorkspaceRedirect, ProjectsPrimaryNavigation } from './ProjectsRouteChrome'
import './ProjectsOutcomes.css'
import './ProjectsOutcomesSections.css'
import './ProjectsCommunicationTheme.css'

export type ProjectsOutcomesRoute = { projectId: string }

export function shouldUseProjectsOutcomes(pathname: string): ProjectsOutcomesRoute | null {
  const match = pathname.match(/^\/projects\/([^/]+)\/outcomes\/?$/)
  return match ? { projectId: decodeURIComponent(match[1]) } : null
}

export function formatOutcomeValue(value: unknown, unit = ''): string {
  if (value === null || value === undefined || value === '') return 'Not recorded'
  return `${String(value)}${unit ? ` ${unit}` : ''}`
}

export function formatOutcomeCurrency(value: unknown, currency: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not recorded'
  const code = String(currency ?? '').trim().toUpperCase()
  const amount = typeof value === 'number' ? value : Number(String(value).trim())
  if (!/^[A-Z]{3}$/.test(code) || !Number.isFinite(amount)) return formatOutcomeValue(value, currency ? String(currency) : '')
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: 0 }).format(amount)
  } catch {
    return formatOutcomeValue(value, code)
  }
}

export function formatOutcomePercent(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not recorded'
  const amount = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(amount) ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)}%` : `${String(value)}%`
}

const jsonOrThrow = async (response: Response) => {
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`

function Header({ projectId, project, section }: { projectId: string; project?: any; section: string }) {
  const sections = [['summary', 'Summary'], ['measurements', 'Measurements'], ['value', 'Value']] as const
  return <><header className="p09-header" data-golden-page-header="true"><div><p className="p05-eyebrow">Projects · delivery evidence</p><h1>Outcomes</h1><p>Delivery acceptance and outcome qualification are separate records.</p>{project ? <p className="p09-project-context"><strong>{project.display_key}</strong> · {project.name}</p> : <p className="p09-project-context">Project {projectId}</p>}</div><ProjectsPrimaryNavigation projectId={projectId} active="outcomes" legacyProjectId={project?.legacy_project_id} /></header><nav className="p09-section-navigation" aria-label="Outcome sections">{sections.map(([key, label]) => <Link key={key} to={`/projects/${encodeURIComponent(projectId)}/outcomes?section=${key}`} aria-current={section === key ? 'page' : undefined}>{label}</Link>)}</nav></>
}

function State({ message, error = false }: { message: string; error?: boolean }) {
  return <p className={error ? 'p09-error' : 'p09-state'} role={error ? 'alert' : undefined}>{message}</p>
}

function MetricCard({ metric }: { metric: any }) {
  const qualification = metric.qualification || {}
  const latest = metric.latest_measurement
  const qualified = qualification.status === 'Qualified'
  return <article className="p09-card p09-metric" data-outcome-metric={metric.id}>
    <div className="p09-card-heading"><div><p className="p09-eyebrow">{metric.kind} · definition {metric.definition_revision}</p><h3><Target size={17} /> {metric.name}</h3></div><span className={`p09-status ${qualified ? 'is-good' : qualification.status === 'Stale' ? 'is-warn' : ''}`}>{qualification.status || 'No data'}</span></div>
    <dl className="p09-facts"><div><dt>Latest</dt><dd>{formatOutcomeValue(qualification.latest_value, metric.unit)}</dd></div><div><dt>Target</dt><dd>{metric.target_spec?.value ?? 'Defined by review'}</dd></div><div><dt>Required periods</dt><dd>{qualification.required_periods ?? metric.required_consecutive_periods}</dd></div><div><dt>Evidence periods</dt><dd>{qualification.periods?.length || 0}</dd></div></dl>
    <p className="p09-explanation">{qualification.reason || 'Record an observation against the current definition.'}</p>
    {latest ? <small className="p09-source">Latest source: {latest.source} · {latest.quality} · {latest.period_start}–{latest.period_end}</small> : null}
  </article>
}

function FinancialSummary({ financial, values }: { financial: any; values?: any }) {
  if (!financial || financial.restricted) return <section id="outcome-value" data-p09-panel="value" className="p09-card p09-section-anchor" aria-labelledby="value-title"><div className="p09-card-heading"><div><p className="p09-eyebrow">Restricted capability</p><h2 id="value-title"><LockKeyhole size={18} /> Value</h2></div></div><State message="Financial detail is omitted because this user does not have the financial.view capability." /></section>
  return <section id="outcome-value" data-p09-panel="value" className="p09-card p09-section-anchor" aria-labelledby="value-title"><div className="p09-card-heading"><div><p className="p09-eyebrow">Exact-decimal summary</p><h2 id="value-title"><CircleDollarSign size={18} /> Value</h2></div></div><div className="p09-financial-grid">{(financial.groups || []).map((group: any) => { const period = group.periods?.[0]; return <div className="p09-financial-group" key={`${group.currency}-${period?.start || 'all'}-${period?.end || 'all'}`}><strong>{group.currency} · {period ? `${period.start}–${period.end}` : 'all recorded periods'}</strong><span>Benefit {formatOutcomeCurrency(group.gross_cash_benefit, group.currency)}</span><span>Cost {formatOutcomeCurrency(group.cost, group.currency)}</span><span>ROI {group.roi_percent !== null && group.roi_percent !== undefined ? formatOutcomePercent(group.roi_percent) : group.roi_state}</span></div>})}<div className="p09-financial-group"><strong>Capacity</strong><span>{financial.capacity?.units || '0'} hours</span><span>{financial.capacity?.valued_amount ? `Separate capacity value ${financial.capacity.valued_amount}` : 'No valuation recorded'}</span></div></div>{values?.isError ? <State error message="The value ledger could not be loaded." /> : values?.items?.length ? <div className="p09-value-ledger" aria-label="Value ledger">{values.items.map((item: any) => <div key={item.id}><strong>{item.kind} · {item.classification}</strong><span>{formatOutcomeCurrency(item.amount, item.currency_or_unit)} · {item.quality}</span></div>)}</div> : null}<p className="p09-explanation">Estimated and forecast entries remain separate from measured cash ROI.</p></section>
}

export default function ProjectsOutcomes() {
  const location = useLocation()
  const navigate = useNavigate()
  const route = shouldUseProjectsOutcomes(location.pathname)
  const projectId = route?.projectId || ''
  const queryClient = useQueryClient()
  const online = useProjectsOnline()
  const [result, setResult] = useState('Partial')
  const [rationale, setRationale] = useState('')
  const [measurementMetricId, setMeasurementMetricId] = useState('')
  const [measurementStart, setMeasurementStart] = useState('')
  const [measurementEnd, setMeasurementEnd] = useState('')
  const [measurementNumerator, setMeasurementNumerator] = useState('')
  const [measurementDenominator, setMeasurementDenominator] = useState('')
  const [measurementSource, setMeasurementSource] = useState('')
  const [measurementEvidence, setMeasurementEvidence] = useState('')
  const [measurementFormError, setMeasurementFormError] = useState('')
  const requestedSection = new URLSearchParams(location.search).get('section') || 'summary'
  const section = ['summary', 'measurements', 'value'].includes(requestedSection) ? requestedSection : 'summary'
  const project = useQuery({ queryKey: ['pv1-project-route', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}`).then(jsonOrThrow), enabled: Boolean(projectId), staleTime: 30_000 })
  const canReadCanonicalOutcomes = Boolean(projectId) && project.isFetched && project.isSuccess && project.data?.legacy_project_id == null
  const outcomes = useQuery({ queryKey: ['p09-outcomes', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/outcomes`).then(jsonOrThrow), enabled: canReadCanonicalOutcomes })
  const values = useQuery({ queryKey: ['p09-values', projectId], queryFn: () => apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/values`).then(jsonOrThrow), enabled: canReadCanonicalOutcomes })
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['pv1-project-route', projectId] }); queryClient.invalidateQueries({ queryKey: ['p09-outcomes', projectId] }); queryClient.invalidateQueries({ queryKey: ['p09-values', projectId] }) }
  const selectedMetricId = (outcomes.data?.metrics || []).some((item: any) => item.id === measurementMetricId) ? measurementMetricId : outcomes.data?.metrics?.[0]?.id || ''
  const recordMeasurement = useMutation({
    mutationFn: () => {
      const metric = (outcomes.data?.metrics || []).find((item: any) => item.id === selectedMetricId)
      const commandId = uuid()
      const body = {
        command_id: commandId,
        type: 'measurement.record',
        expected: { project_revision: project.data?.revision },
        payload: {
          metric_id: selectedMetricId,
          definition_revision: metric?.definition_revision,
          period_start: measurementStart,
          period_end: measurementEnd,
          numerator: Number(measurementNumerator),
          denominator: Number(measurementDenominator),
          unit: metric?.unit,
          source: measurementSource,
          quality: 'Verified',
          evidence: [{ id: measurementEvidence }],
        },
      }
      return apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId }, body: JSON.stringify(body) }).then(jsonOrThrow)
    },
    onSuccess: () => { refresh(); setMeasurementNumerator(''); setMeasurementDenominator(''); setMeasurementEvidence('') },
  })
  const close = useMutation({ mutationFn: () => {
    const metrics = (outcomes.data?.metrics || []).filter((item: any) => item.qualification?.qualified)
    const measurementIds = metrics.flatMap((item: any) => item.qualification?.periods || [])
    const commandId = uuid()
    return apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId }, body: JSON.stringify({ command_id: commandId, type: 'outcomes.close', expected: { project_revision: project.data?.revision }, payload: { result, metric_revision_ids: metrics.map((item: any) => item.id), measurement_ids: measurementIds, rationale } }) }).then(jsonOrThrow)
  }, onSuccess: refresh })
  const reopen = useMutation({ mutationFn: () => {
    const commandId = uuid()
    return apiFetch(`/api/v2/projects/${encodeURIComponent(projectId)}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId }, body: JSON.stringify({ command_id: commandId, type: 'outcomes.reopen', expected: { project_revision: project.data?.revision }, payload: { reason: rationale } }) }).then(jsonOrThrow)
  }, onSuccess: refresh })
  const pending = close.isPending || reopen.isPending
  const qualificationCount = useMemo(() => (outcomes.data?.metrics || []).filter((item: any) => item.qualification?.qualified).length, [outcomes.data])
  if (!route) return null
  if (project.isPending) return <main className="p09-page" data-workspace="projects" data-pv1-projects-route="true" data-p09-outcomes="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} section={section} /><State message="Loading project outcomes…" /></main>
  if (project.isError) return <main className="p09-page" data-workspace="projects" data-pv1-projects-route="true" data-p09-outcomes="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} section={section} /><State error message="This project could not be loaded. Check access, then retry." /><button className="p09-secondary" onClick={() => project.refetch()}>Retry</button></main>
  if (project.data?.legacy_project_id != null) return <main className="p09-page" data-workspace="projects" data-pv1-projects-route="true" data-p09-outcomes="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} project={project.data} section={section} /><ProjectsLegacyWorkspaceRedirect project={project.data} view="insights" section={section} /></main>
  if (outcomes.isPending) return <main className="p09-page" data-workspace="projects" data-pv1-projects-route="true" data-p09-outcomes="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} project={project.data} section={section} /><State message="Loading outcome evidence…" /></main>
  if (outcomes.isError) return <main className="p09-page" data-workspace="projects" data-pv1-projects-route="true" data-p09-outcomes="true"><ProjectsOfflineNotice online={online} /><Header projectId={projectId} project={project.data} section={section} /><State error message="Outcome evidence could not be loaded." /><button className="p09-secondary" onClick={() => outcomes.refetch()}>Retry</button></main>
  const delivery = outcomes.data?.delivery || {}
  const outcome = outcomes.data?.outcomes || {}
  return <main className="p09-page" data-workspace="projects" data-pv1-projects-route="true" data-p09-outcomes="true" data-p09-section={section}><ProjectsOfflineNotice online={online} /><Header projectId={projectId} project={project.data} section={section} />
    <section className="p09-hero"><div><p className="p09-eyebrow">{project.data?.display_key || projectId}</p><h2>{project.data?.name || 'Project outcomes'}</h2><p>{project.data?.objective || 'No objective recorded.'}</p></div><div className="p09-hero-state"><span>Delivery</span><strong>{delivery.phase || 'Unknown'}</strong><span>Outcome</span><strong>{outcome.result || outcome.phase || 'Unassessed'}</strong></div></section>
    <div className="p09-grid"><section id="outcome-summary" data-p09-panel="summary" className="p09-card p09-section-anchor" aria-labelledby="delivery-title"><div className="p09-card-heading"><div><p className="p09-eyebrow">Acceptance snapshot</p><h2 id="delivery-title"><ClipboardCheck size={18} /> Delivery acceptance</h2></div><span className="p09-status">{delivery.latest_acceptance ? 'Accepted' : 'Not accepted'}</span></div>{delivery.latest_acceptance ? <><p>Reviewed by {delivery.latest_acceptance.reviewer_id || 'an authorized reviewer'} at {delivery.latest_acceptance.accepted_at || 'recorded time'}.</p><p className="p09-source">Source snapshot is retained at the acceptance revision; reopening creates a new delivery review without erasing history.</p><ul className="p09-checkpoints">{(delivery.latest_acceptance.followups || []).map((item: any, index: number) => <li key={`${item.kind}-${item.due_date}-${index}`}><span>{item.kind}</span><strong>{item.due_date}</strong><small>{item.state || 'Pending'}</small></li>)}</ul></> : <div className="p09-empty-acceptance" data-outcome-acceptance-empty><strong>No delivery acceptance snapshot</strong><p>Capture task, criterion, and evidence snapshots before closing this outcome.</p><Link to={'/projects/' + encodeURIComponent(projectId) + '/home'}>Review project criteria</Link></div>}</section>
      <section className="p09-card" data-p09-panel="summary measurements" aria-labelledby="qualification-title"><div className="p09-card-heading"><div><p className="p09-eyebrow">Independent result</p><h2 id="qualification-title"><CheckCircle2 size={18} /> Qualification</h2></div><span className="p09-status">{qualificationCount} qualified</span></div><p>Task progress is not used as an outcome result. Each current metric definition needs its own verified, fresh evidence.</p><div className="p09-metric-list">{(outcomes.data?.metrics || []).map((metric: any) => <MetricCard key={metric.id} metric={metric} />)}{!(outcomes.data?.metrics || []).length ? <State message="No metric definitions are recorded yet." /> : null}</div></section>
      <section id="outcome-measurements" data-p09-panel="measurements" className="p09-card p09-section-anchor" aria-labelledby="measurement-title"><div className="p09-card-heading"><div><p className="p09-eyebrow">Append-only observations</p><h2 id="measurement-title"><Target size={18} /> Measurements</h2></div><span className="p09-status">{outcomes.data?.measurements?.length || 0} records</span></div>{outcomes.data?.metrics?.length ? <form className="p09-measurement-form" data-project-ui-form="true" onSubmit={(event) => { event.preventDefault(); const metric = outcomes.data?.metrics?.find((item: any) => item.id === selectedMetricId); if (!measurementStart || !measurementEnd || measurementEnd <= measurementStart || Number(measurementDenominator) <= 0) { setMeasurementFormError('Choose an end date after the start date and a denominator greater than zero.'); return } if (metric?.kind === 'Adoption' && Number(measurementNumerator) > Number(measurementDenominator)) { setMeasurementFormError('For adoption, the numerator cannot exceed the eligible denominator.'); return } setMeasurementFormError(''); recordMeasurement.mutate() }}><label>Metric<select value={selectedMetricId} onChange={(event) => setMeasurementMetricId(event.target.value)} required><option value="">Select metric</option>{outcomes.data.metrics.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Period start<input type="date" value={measurementStart} max={measurementEnd || undefined} onChange={(event) => { setMeasurementStart(event.target.value); setMeasurementFormError('') }} required /></label><label>Period end<input type="date" value={measurementEnd} min={measurementStart || undefined} onChange={(event) => { setMeasurementEnd(event.target.value); setMeasurementFormError('') }} required /></label><label>Numerator<input type="number" min="0" step="any" value={measurementNumerator} onChange={(event) => setMeasurementNumerator(event.target.value)} required /></label><label>Denominator<input type="number" min="1" step="any" value={measurementDenominator} onChange={(event) => setMeasurementDenominator(event.target.value)} required /></label><label>Source<input value={measurementSource} onChange={(event) => setMeasurementSource(event.target.value)} placeholder="Approved export" required /></label><label>Evidence reference<input value={measurementEvidence} onChange={(event) => setMeasurementEvidence(event.target.value)} placeholder="Evidence ID" required /></label><button className="p09-primary" type="submit" disabled={recordMeasurement.isPending || !selectedMetricId}>Record verified measurement</button>{measurementFormError ? <p className="p09-error" role="alert">{measurementFormError}</p> : null}</form> : null}{recordMeasurement.isError ? <State error message="Measurement could not be recorded. Review the dates and evidence, then retry." /> : recordMeasurement.isSuccess ? <p className="p09-success" role="status">Verified measurement recorded.</p> : null}<div className="p09-table-wrap"><table><caption className="sr-only">Outcome measurements</caption><thead><tr><th>Period</th><th>Value</th><th>Quality</th><th>Source</th><th>History</th></tr></thead><tbody>{(outcomes.data?.measurements || []).map((item: any) => <tr key={item.id}><td>{item.period_start}–{item.period_end}</td><td>{formatOutcomeValue(item.calculated_value ?? item.imported_percentage, item.unit)}<small>{item.calculated_state}</small></td><td>{item.quality}</td><td>{item.source}</td><td>{item.supersedes_id ? `Correction of ${item.supersedes_id.slice(0, 8)}` : 'Original'}</td></tr>)}</tbody></table>{!(outcomes.data?.measurements || []).length ? <State message="No measurements recorded yet." /> : null}</div></section>
      <FinancialSummary financial={outcomes.data?.financial} values={values.data} />
      <section className="p09-card p09-actions-card" data-p09-panel="summary" aria-labelledby="closure-title"><div className="p09-card-heading"><div><p className="p09-eyebrow">Human review</p><h2 id="closure-title"><RotateCcw size={18} /> Close or reopen outcome</h2></div></div><p>Closure records the reviewed result and evidence snapshot; it does not rewrite measurements or delivery acceptance.</p><div className="p09-form" data-project-ui-form="true"><label>Result<select value={result} onChange={(event) => setResult(event.target.value)} disabled={pending}><option>Realized</option><option>Partial</option><option>Not realized</option><option>Not applicable</option></select></label><label>Review rationale<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Explain the evidence, gaps, or correction rationale." disabled={pending} required /></label></div><div className="p09-actions"><button className="p09-primary" onClick={() => close.mutate()} disabled={pending || !rationale.trim() || outcome.phase === 'Closed'}>Save reviewed outcome</button>{outcome.phase === 'Closed' ? <button className="p09-secondary" onClick={() => reopen.mutate()} disabled={pending || !rationale.trim()}>Reopen outcome</button> : null}</div>{close.isError || reopen.isError ? <State error message={(close.error as Error)?.message || (reopen.error as Error)?.message || 'Outcome command failed.'} /> : null}{close.isSuccess || reopen.isSuccess ? <p className="p09-success" role="status">Outcome evidence refreshed from the server.</p> : null}</section>
    </div><button className="p09-back" onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}/home`)}>Back to Project Home</button>
  </main>
}
