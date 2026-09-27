import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/apiClient'
import { ArchitectureCanvas } from './ArchitectureCanvas'
import { normalizeArchitectureProjection, type ArchitectureMode, type ArchitectureProjection } from './core'

type ModelSummary = { id: string; name: string; description?: string | null; revision: number }
type Props = { projectId?: string; compact?: boolean; initialMode?: ArchitectureMode }
const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`

async function jsonOrThrow(response: Response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) { const error = new Error(String(body.message || body.detail || 'Architecture request failed')) as Error & { data?: unknown }; error.data = body; throw error }
  return body
}

async function fetchJson(path: string, init?: RequestInit) { return jsonOrThrow(await apiFetch(path, init)) }

const queryMode = (location: ReturnType<typeof useLocation>, fallback: ArchitectureMode): ArchitectureMode => {
  const value = new URLSearchParams(location.search).get('mode')
  return value === 'impact' || value === 'proposed' ? value : fallback
}

export function ArchitectureHost({ projectId, compact = false, initialMode = 'current' }: Props) {
  const location = useLocation(); const navigate = useNavigate()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const requestedModelId = params.get('model') || ''
  const [selectedModelId, setSelectedModelId] = useState(requestedModelId)
  const [mode, setMode] = useState<ArchitectureMode>(() => queryMode(location, initialMode))
  const [newModelName, setNewModelName] = useState('')
  const [proposalName, setProposalName] = useState('')
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState('')

  useEffect(() => { if (requestedModelId) setSelectedModelId(requestedModelId) }, [requestedModelId])
  useEffect(() => { setMode(queryMode(location, initialMode)) }, [location.search, initialMode])

  const modelsQuery = (globalThis as any).ReactQuery?.useQuery
  // Keep the host independent of a second React Query provider in compact panel tests.
  const [modelSummaries, setModelSummaries] = useState<ModelSummary[]>([])
  const [projection, setProjection] = useState<ArchitectureProjection | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [projectArchitecture, setProjectArchitecture] = useState<any>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setFailure('')
    const load = async () => {
      try {
        const list = await fetchJson('/api/v2/architecture/models')
        if (cancelled) return
        setModelSummaries(Array.isArray(list.items) ? list.items : [])
        let modelId = selectedModelId || requestedModelId || String(list.items?.[0]?.id || '')
        if (projectId) {
          const associated = await fetchJson(`/api/v2/architecture/projects/${encodeURIComponent(projectId)}/architecture?mode=${mode}${params.get('changeset') ? `&changeset=${encodeURIComponent(params.get('changeset')!)}` : ''}`)
          if (cancelled) return
          setProjectArchitecture(associated)
          const associatedModel = associated.models?.[0]
          if (associatedModel) { modelId = associatedModel.model.id; setSelectedModelId(modelId); setProjection(normalizeArchitectureProjection(associatedModel)); setLoading(false); return }
        }
        if (!modelId) { setProjection(null); setLoading(false); return }
        setSelectedModelId(modelId)
        const suffix = [`mode=${mode}`, projectId ? `project=${encodeURIComponent(projectId)}` : '', params.get('changeset') ? `changeset=${encodeURIComponent(params.get('changeset')!)}` : ''].filter(Boolean).join('&')
        const next = await fetchJson(`/api/v2/architecture/models/${encodeURIComponent(modelId)}?${suffix}`)
        if (!cancelled) setProjection(normalizeArchitectureProjection(next))
      } catch (error) { if (!cancelled) { setFailure(error instanceof Error ? error.message : 'Architecture unavailable.'); setProjection(null) } } finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [projectId, mode, refreshNonce, requestedModelId, selectedModelId, params])

  const updateMode = (next: ArchitectureMode) => {
    if (next === 'proposed' && !params.get('changeset')) { setMessage('Create a Draft change set before opening Proposed mode.'); return }
    setMode(next)
    const nextParams = new URLSearchParams(location.search); nextParams.set('mode', next)
    navigate(`${location.pathname}?${nextParams.toString()}`, { replace: true })
  }

  const command = async (type: string, payload: Record<string, unknown>) => {
    if (!selectedModelId || !projection) return
    const commandId = uuid()
    try {
      await fetchJson(`/api/v2/architecture/models/${encodeURIComponent(selectedModelId)}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId }, body: JSON.stringify({ command_id: commandId, type, expected: { model_revision: projection.model.revision }, payload }) })
      setMessage(`${type} applied at the canonical model.`); setRefreshNonce((value) => value + 1)
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Architecture command failed.') }
  }

  const createModel = async () => {
    if (!newModelName.trim()) return
    const commandId = uuid()
    try { const result = await fetchJson('/api/v2/architecture/models', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId }, body: JSON.stringify({ command_id: commandId, name: newModelName.trim() }) }); setNewModelName(''); setSelectedModelId(result.model.id); const next = new URLSearchParams(location.search); next.set('model', result.model.id); next.set('mode', 'current'); navigate(`${location.pathname}?${next.toString()}`, { replace: true }); setRefreshNonce((value) => value + 1) } catch (error) { setFailure(error instanceof Error ? error.message : 'Architecture model creation failed.') }
  }

  const createProposal = async () => {
    if (!selectedModelId || !projection || !proposalName.trim()) return
    const commandId = uuid()
    try {
      const result = await fetchJson('/api/v2/architecture/change-sets', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId }, body: JSON.stringify({ command_id: commandId, model_id: selectedModelId, operations: [{ op_type: 'object.create', target_id: uuid(), payload: { kind: 'Datastore', name: proposalName.trim(), lifecycle: 'Planned' } }] }) })
      const changeSetId = result.change_set.id
      setProposalName('')
      const next = new URLSearchParams(location.search); next.set('model', selectedModelId); next.set('changeset', changeSetId); next.set('mode', 'proposed'); navigate(`${location.pathname}?${next.toString()}`, { replace: true }); setMode('proposed'); setMessage('Draft change set created; Current remains unchanged.'); setRefreshNonce((value) => value + 1)
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Change set creation failed.') }
  }

  const changeSetAction = async (action: 'submit' | 'approve' | 'apply' | 'rebase') => {
    const changeSetId = params.get('changeset'); if (!changeSetId) return
    const commandId = uuid()
    try { await fetchJson(`/api/v2/architecture/change-sets/${encodeURIComponent(changeSetId)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId }, body: JSON.stringify({ command_id: commandId }) }); setMessage(`Change set ${action} applied.`); setRefreshNonce((value) => value + 1) } catch (error) { setFailure(error instanceof Error ? error.message : `Change set ${action} failed.`) }
  }

  const openFull = () => {
    if (!selectedModelId) return
    const next = new URLSearchParams(); next.set('model', selectedModelId); next.set('mode', mode); if (projectId) next.set('project', projectId); if (params.get('changeset')) next.set('changeset', params.get('changeset')!); next.set('return', `${location.pathname}${location.search}`)
    window.location.assign(`/architecture?${next.toString()}`)
  }

  if (loading) return <section aria-busy="true" data-pv1-architecture-state="loading" style={{ padding: 24 }}><p>Loading canonical Architecture…</p></section>
  if (failure && !projection) return <section role="alert" data-pv1-architecture-state="unavailable" style={{ padding: 24 }}><h2>Architecture unavailable</h2><p>{failure}</p><button type="button" onClick={() => setRefreshNonce((value) => value + 1)}>Retry</button></section>
  if (!projection) return <section data-pv1-architecture-state="empty" className="min-w-0 rounded-lg border border-[var(--pv1-border,rgba(148,163,184,.25))] p-3 sm:p-6"><h2 className="break-words">{projectId ? 'No Architecture model is linked' : 'Create an Architecture model'}</h2><p className="break-words">{projectId ? 'This Project stores canonical object references only. Link a model from the full Architecture workspace.' : 'A model is the durable source for objects, relations, diagrams and change sets.'}</p>{!projectId ? <form onSubmit={(event) => { event.preventDefault(); void createModel() }} className="mt-4 flex w-full max-w-[520px] min-w-0 flex-wrap items-stretch gap-2" data-architecture-create-model="true"><input aria-label="New Architecture model name" value={newModelName} onChange={(event) => setNewModelName(event.target.value)} placeholder="Platform architecture" className="min-w-0 flex-1 basis-[14rem] rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-400 outline-none focus:border-blue-400" style={{ minHeight: 40 }} /><button type="submit" className="min-h-10 shrink-0 px-3 py-2" disabled={!newModelName.trim()}>Create model</button></form> : null}</section>
  const changeSetId = params.get('changeset')
  return <section data-pv1-architecture-host="true" data-pv1-architecture-project={projectId || undefined} style={{ padding: compact ? 12 : 24, minHeight: 0, overflow: 'auto' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>{modelSummaries.length > 1 ? <label>Model<select aria-label="Architecture model selector" value={selectedModelId} onChange={(event) => { setSelectedModelId(event.target.value); const next = new URLSearchParams(location.search); next.set('model', event.target.value); navigate(`${location.pathname}?${next.toString()}`, { replace: true }) }}><option value="">Select model</option>{modelSummaries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}{failure ? <p role="alert">{failure}</p> : null}{message ? <p role="status" aria-live="polite">{message}</p> : null}</div>{changeSetId ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}><span>Change set {changeSetId.slice(0, 8)}…</span><button type="button" onClick={() => void changeSetAction('submit')}>Submit</button><button type="button" onClick={() => void changeSetAction('approve')}>Approve</button><button type="button" onClick={() => void changeSetAction('apply')}>Apply</button><button type="button" onClick={() => void changeSetAction('rebase')}>Rebase</button></div> : <form onSubmit={(event) => { event.preventDefault(); void createProposal() }} style={{ display: 'flex', gap: 8, maxWidth: 640, marginBottom: 12 }}><input aria-label="Proposed object name" value={proposalName} onChange={(event) => setProposalName(event.target.value)} placeholder="Draft proposed datastore or service" style={{ flex: 1, minHeight: 40 }} /><button type="submit" disabled={!proposalName.trim()}>Create Draft proposal</button></form>}<ArchitectureCanvas projection={projection} mode={mode} compact={compact} readOnly={mode === 'proposed' || !projection.capabilities.edit} onModeChange={updateMode} onCommand={command} onOpenFull={compact ? openFull : undefined} /></section>
}

export default ArchitectureHost
