import React from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { buildProjectsDestinationPath, buildProjectsLegacyWorkspacePath, type ProjectsDestination, type ProjectsRoute } from './ProjectsNavigation'
import './ProjectsRouteChrome.css'

type PrimaryProjectRoute = 'home' | 'work' | 'plan' | 'timeline' | 'updates' | 'outcomes'
type ProjectNavigationExtra = { label: string; href: string; active?: boolean }

const primaryRoutes: Array<{ key: PrimaryProjectRoute; label: string; destination: ProjectsDestination; legacyView: ProjectsRoute['legacyView']; section?: string; legacySection?: string }> = [
  { key: 'home', label: 'Home', destination: 'home', legacyView: 'overview' },
  { key: 'work', label: 'Work', destination: 'work', legacyView: 'tasks' },
  { key: 'plan', label: 'Plan', destination: 'plan', legacyView: 'insights', section: 'brief', legacySection: 'brief' },
  { key: 'timeline', label: 'Timeline', destination: 'timeline', legacyView: 'timeline' },
  { key: 'updates', label: 'Updates', destination: 'updates', legacyView: 'updates' },
  { key: 'outcomes', label: 'Outcomes', destination: 'outcomes', legacyView: 'insights', section: 'summary', legacySection: 'summary' },
]

export function ProjectsPrimaryNavigation({ projectId, active, legacyProjectId, extras = [] }: {
  projectId: string
  active: PrimaryProjectRoute
  legacyProjectId?: number | null
  extras?: ProjectNavigationExtra[]
}) {
  return <div className="sg-pv1-navigation-stack">
    <nav className="sg-pv1-project-navigation" aria-label="Project primary navigation">
      {primaryRoutes.map((item) => {
        const href = item.key === 'home'
          ? `/projects/${encodeURIComponent(projectId)}/home`
          : legacyProjectId != null
            ? buildProjectsLegacyWorkspacePath(legacyProjectId, item.legacyView, item.legacySection ?? item.section)
            : buildProjectsDestinationPath(projectId, item.destination, item.destination === 'work' ? { layout: 'list' } : item.section ? { section: item.section } : {})
        return <Link key={item.key} to={href} aria-current={item.key === active ? 'page' : undefined}>{item.label}</Link>
      })}
    </nav>
    {extras.length ? <nav className="sg-pv1-project-subnavigation" aria-label="Project subnavigation">
      {extras.map((item) => <Link key={item.label} to={item.href} aria-current={item.active ? 'page' : undefined}>{item.label}</Link>)}
    </nav> : null}
  </div>
}

export function ProjectsLegacyWorkspaceRedirect({ project, view, section }: { project: { id: string; legacy_project_id?: number | null; display_key?: string; name?: string }; view: ProjectsRoute['legacyView']; section?: string }) {
  const location = useLocation()
  if (project.legacy_project_id == null) return null
  const destination = buildProjectsLegacyWorkspacePath(project.legacy_project_id, view, section)
  const current = new URLSearchParams(location.search)
  const retained = new URLSearchParams()
  const selectedTask = current.get('task') || (current.get('panel') === 'task' ? current.get('entity') : null)
  if (selectedTask) retained.set('task', selectedTask)
  for (const key of ['report', 'showcase', 'saved_view']) {
    const value = current.get(key)
    if (value) retained.set(key, value)
  }
  const query = retained.toString()
  return <Navigate to={query ? `${destination}&${query}` : destination} replace />
}
