// SYSGRID_ALLOW_SOURCE_OWNERSHIP_ASSERTION — exact source ownership is the contract for canonical Projects routing/writes.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(process.cwd(), 'src')
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8')
const wrapper = fs.readFileSync(path.join(root, 'components/ProjectsSchedulingCompletion.tsx'), 'utf8')
const model = fs.readFileSync(path.join(root, 'components/ProjectsSchedulingCompletion.model.ts'), 'utf8')
const timeline = fs.readFileSync(path.join(root, 'components/ProjectsTimeline.tsx'), 'utf8')

describe('OUT-38 source contract', () => {
  it('keeps one Gantt renderer while routing canonical deep links to the v2 schedule authority', () => {
    expect(app).toContain("const Projects = lazy(() => import('./components/ProjectsSchedulingCompletion'))")
    expect(app).toContain('<Route path="/projects/*" element={<ModulePolicyGate moduleId="projects"><Projects /></ModulePolicyGate>} />')
    expect(app).not.toMatch(/import\s+Projects\s+from\s/)
    expect(wrapper).toContain("import ProjectsGolden from './ProjectsGolden'")
    expect(wrapper).toContain('<ProjectsGolden />')
    expect(wrapper).toContain("view === 'timeline'")
    expect(wrapper).toContain('shouldUseProjectsTimeline(location.pathname)')
    expect(timeline).toContain('<ProjectsModernGantt')
  })

  it('uses pure v2 previews and one atomic command on the canonical route', () => {
    expect(timeline).toContain('/schedule/preview')
    expect(timeline).toContain("sendCommand('schedule.apply'")
    expect(timeline).toContain("setMessage('Schedule preview cancelled; zero mutations were sent.')")
    expect(timeline).toContain('preview_id: candidate.preview.preview_id')
    expect(timeline).toContain('preview_hash: candidate.preview.content_hash')
  })

  it('retains the full Project PUT only for legacy route compatibility', () => {
    expect(wrapper).toContain("apiFetch('/api/v1/projects')")
    expect(wrapper).toContain('projectFingerprint(remote) !== projectFingerprint(baseProject)')
    expect(wrapper).toContain("apiFetch(`/api/v1/projects/${nextProject.id}`, { method: 'PUT', body: JSON.stringify(nextProject) })")
    expect(wrapper).not.toMatch(/\/api\/v1\/projects\/[^`'\"]*schedule/)
    expect(timeline).not.toContain("method: 'PUT'")
  })

  it('keeps typed scheduling metadata additive and capacity authority explicit', () => {
    expect(model).toContain("project_schedule_v2")
    expect(model).toContain("project_schedule_constraint_v1")
    expect(model).toContain("['FS', 'SS', 'FF', 'SF']")
    expect(model).toContain("status: !authoritative ? 'UNKNOWN'")
  })
})

describe('OUT-40 schedule control accessibility contract', () => {
  it('owns explicit dialog, keyboard restoration and live mutation semantics', () => {
    expect(wrapper).toContain('aria-expanded={open}')
    expect(wrapper).toContain('aria-controls="project-schedule-control-drawer"')
    expect(wrapper).toContain('aria-haspopup="dialog"')
    expect(wrapper).toContain('role="dialog"')
    expect(wrapper).toContain('aria-modal="true"')
    expect(wrapper).toContain('onKeyDown={handleScheduleDialogKeyDown}')
    expect(wrapper).toContain('scheduleToggleRef.current?.focus()')
    expect(wrapper).toContain('data-project-schedule-live-status="true"')
    expect(wrapper).toContain('setLiveMessage(label)')
    expect(wrapper).toContain("setLiveMessage(message)")
  })

  it('keeps functional text and critical controls above the Projects hardening floor', () => {
    expect(wrapper).toContain('const controlStyle = { minHeight: 40, minWidth: 40 } as const')
    expect(wrapper.match(/style=\{controlStyle\}/g)?.length).toBe(11)
    expect(wrapper).toContain('min-h-[40px]')
    expect(wrapper).toContain('min-w-[40px]')
    expect(wrapper).toContain('grid grid-cols-2 gap-1 sm:grid-cols-7')
    expect(wrapper).toContain('grid grid-cols-1 gap-2 sm:grid-cols-2')
    expect(wrapper).toContain('sm:w-[470px]')
    expect(wrapper).not.toMatch(/text-\[(?:[0-9]|1[01])px\]/)
  })
})
