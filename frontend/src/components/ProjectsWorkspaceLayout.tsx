import React, { createContext, useContext, useState } from 'react'
import ProjectsModernGantt from './ProjectsModernGantt'
import { canonicalTaskStatus, readableProjectDate } from './ProjectsVisualRepair.geometry'
import './ProjectsVisualRepair.css'

type TimelineAuthority = { onPersist: (project: any, label: string, baseProject?: any) => any; isSaving: boolean; scheduleControl?: React.ReactNode }
export const ProjectsTimelineAuthority = createContext<TimelineAuthority | null>(null)
/** The Timeline is now rendered once, in the existing workspace's content slot. */
export function ProjectsTimelineHost({ project }: { project: any }) {
  const authority = useContext(ProjectsTimelineAuthority)
  if (!authority) return <div role="alert">Timeline persistence provider is unavailable.</div>
  return <div className="sg-timeline-host">{authority.scheduleControl && <div className="sg-schedule-command">{authority.scheduleControl}</div>}<ProjectsModernGantt project={project} onPersist={authority.onPersist} isSaving={authority.isSaving}/></div>
}
/** Projects-only shell. Keep supplied action callbacks; make infrequent actions expandable. */
export function ProjectsWorkspaceFrame({ header, commandBar, children, className = '' }: any) {
  return <div className={`sg-projects-frame ${className}`} data-workspace="projects" data-golden-workspace-shell="true" data-golden-workspace="projects" data-golden-archetype="hybrid" data-golden-geometry-version="1">
    <div className="sg-workspace-command"><div className="sg-workspace-picker"><strong>{header?.title || 'Projects'}</strong>{commandBar?.left}</div><details className="sg-workspace-actions"><summary>Workspace actions</summary><div>{commandBar?.right}</div></details></div>
    {children}
  </div>
}
export function ProjectsCompactHeader({ project, onEditProject, onMeasureOutcome, onJump, onQuickAction, details }: any) {
  const [expanded, setExpanded] = useState(false)
  if (!project) return null
  const tasks = Array.isArray(project.tasks) ? project.tasks : []
  const done = tasks.filter((task: any) => canonicalTaskStatus(task.status) === 'Completed').length
  const owner = project.owner || (Array.isArray(project.owners) ? project.owners.join(', ') : '') || 'Unassigned'
  return <section className="sg-project-context" data-project-workbench-header="true">
    <div className="sg-context-line"><div className="sg-context-title"><h2 title={project.name}>{project.name}</h2><span>{project.status || 'No status'} · {done}/{tasks.length} tasks complete</span></div>
      <div className="sg-context-actions"><button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Less' : 'Project info'}</button><details><summary>Add / edit</summary><div className="sg-context-menu">
        <button onClick={() => onQuickAction?.('task')}>Add task</button><button onClick={() => onQuickAction?.('update')}>Write update</button><button onClick={() => onQuickAction?.('material')}>Add material</button><button onClick={() => onQuickAction?.('report')}>Capture report</button><button onClick={() => onQuickAction?.('governance')}>Governance</button><button onClick={onEditProject}>Edit project</button><button onClick={onMeasureOutcome}>Measure outcomes</button>
      </div></details></div>
    </div>
    {expanded && <div className="sg-context-expanded">{details || <><p>{project.objective || project.problem_statement || 'No objective recorded.'}</p><span>Owner: {owner}</span><span>Finish: {readableProjectDate(project.end_date || project.target_date)}</span><button onClick={() => onJump?.('overview')}>Open overview</button></>}</div>}
  </section>
}
export { useProjectsNavigation, ProjectsNavigationButton, ProjectsNavigationBackdrop } from './ProjectsShellNavigation'
