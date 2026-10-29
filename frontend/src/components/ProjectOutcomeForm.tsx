import React, { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, Layers3, Target } from 'lucide-react'
import { ProjectForm } from './Projects'
import { getValidParentProjects, projectExpectedOutcomes } from './ProjectsGolden.hierarchy'

export function ProjectOutcomeForm({ initialData, projects, onSave, isSaving, onCancel, devices, services, options, hideFormActions = false, onSubmitReady }: any) {
  const initialParent = initialData?.parent_project_id ?? null
  const [kind, setKind] = useState<'top' | 'subproject'>(initialParent == null ? 'top' : 'subproject')
  const [parentId, setParentId] = useState(initialParent == null ? '' : String(initialParent))
  const [objective, setObjective] = useState(String(initialData?.objective || ''))
  const [outcomesText, setOutcomesText] = useState(projectExpectedOutcomes(initialData).join('\n'))
  const [error, setError] = useState('')
  const errorRef = useRef<HTMLParagraphElement | null>(null)
  const candidates = useMemo(() => getValidParentProjects(projects || [], initialData?.id), [projects, initialData?.id])
  const expectedOutcomes = outcomesText.split('\n').map((item) => item.trim()).filter(Boolean)
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [error])

  const save = (project: any) => {
    const parentProjectId = kind === 'subproject' && parentId ? Number(parentId) : null
    if (!objective.trim()) { setError('Describe the project outcome before saving.'); return }
    if (!expectedOutcomes.length) { setError('Add at least one measurable definition of done before saving.'); return }
    if (kind === 'subproject' && parentProjectId == null) { setError('Choose a parent project before saving.'); return }
    if (kind === 'subproject' && !String(project.owner || '').trim()) { setError('A subproject requires an accountable owner.'); return }
    if (kind === 'subproject' && (!project.start_date || !project.end_date)) { setError('A subproject requires start and finish dates.'); return }
    setError('')
    onSave({ ...project, objective: objective.trim(), expected_outcomes: expectedOutcomes, parent_project_id: parentProjectId })
  }

  return <div className="space-y-4" data-project-outcome-form="true">
    <section className="rounded-lg border border-blue-500/15 bg-blue-500/[0.035] p-4" data-project-kind-choice="true">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-sm font-black text-white">Project outcome</h3><p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-400">Describe the useful result this project will deliver. Keep phases such as design, build and rollout in the task plan.</p></div>
        <span className="rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-blue-300">Project structure</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => { setKind('top'); setParentId('') }} aria-pressed={kind === 'top'} className={`rounded-lg border p-3 text-left ${kind === 'top' ? 'border-blue-500/40 bg-blue-500/10' : 'border-white/10 bg-[var(--sg-surface-1)]'}`}><Target size={16} className="text-blue-300" /><b className="mt-2 block text-[12px] text-[var(--text-primary)]">Top-level project</b><span className="mt-1 block text-[10px] text-slate-500">One independently tracked outcome in the portfolio.</span></button>
        <button type="button" onClick={() => setKind('subproject')} aria-pressed={kind === 'subproject'} className={`rounded-lg border p-3 text-left ${kind === 'subproject' ? 'border-violet-500/40 bg-violet-500/10' : 'border-white/10 bg-[var(--sg-surface-1)]'}`}><GitBranch size={16} className="text-violet-300" /><b className="mt-2 block text-[12px] text-[var(--text-primary)]">Subproject</b><span className="mt-1 block text-[10px] text-slate-500">A separate outcome with its own owner, success measures and dates.</span></button>
      </div>
      {kind === 'subproject' ? <label className="mt-4 block text-[11px] font-black uppercase tracking-widest text-slate-500">Parent project<select aria-label="Parent project" value={parentId} onChange={(event) => setParentId(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-[var(--sg-surface-2)] px-3 py-2.5 text-[11px] normal-case text-white"><option value="">Choose a parent project…</option>{candidates.map((project: any) => <option key={String(project.id)} value={String(project.id)}>{project.name || `Project ${project.id}`}</option>)}</select></label> : <div className="mt-4 rounded-lg border border-emerald-500/10 bg-emerald-500/[0.03] px-3 py-2 text-[11px] text-emerald-300">Only top-level projects count as portfolio outcomes. A top-level project cannot have a parent.</div>}
    </section>

    <section className="grid gap-3 rounded-lg border border-white/10 bg-[var(--sg-surface-1)] p-4 md:grid-cols-2" data-project-outcome-definition="true">
      <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Project outcome <span aria-hidden="true" className="text-rose-500">*</span><textarea required aria-label="Project outcome" rows={4} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="What useful result will this project deliver?" className="mt-2 w-full rounded-lg border border-white/10 bg-[var(--sg-surface-2)] px-3 py-2 text-[12px] normal-case leading-5 text-white outline-none focus:border-blue-500/40" /></label>
      <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Definition of done <span aria-hidden="true" className="text-rose-500">*</span><textarea required aria-label="Definition of done" rows={4} value={outcomesText} onChange={(event) => setOutcomesText(event.target.value)} placeholder={'Add one measurable completion criterion per line\nExample: 95% of target users activated'} className="mt-2 w-full rounded-lg border border-white/10 bg-[var(--sg-surface-2)] px-3 py-2 text-[12px] normal-case leading-5 text-white outline-none focus:border-blue-500/40" /></label>
      <div className="md:col-span-2 flex items-start gap-2 rounded-lg border border-amber-500/10 bg-amber-500/[0.03] px-3 py-2 text-[11px] leading-4 text-amber-200"><Layers3 size={14} className="mt-0.5 shrink-0" /><span><b>Keep phases in the task plan.</b> Create a subproject only when it has a separate outcome and owner.</span></div>
      {error ? <p ref={errorRef} role="alert" className="md:col-span-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2 text-[11px] font-semibold text-rose-300">{error}</p> : null}
    </section>

    <section className="rounded-lg border border-white/5 bg-white/[0.015] p-3"><p className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500">Project details</p><ProjectForm initialData={initialData} onSave={save} isSaving={isSaving} onCancel={onCancel} devices={devices} services={services} options={options} hideActions={hideFormActions} onSubmitReady={onSubmitReady} /></section>
  </div>
}
