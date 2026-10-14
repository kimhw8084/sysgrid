import { useCallback, useEffect, useId, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import toast from 'react-hot-toast'
import { apiClient } from '../../api/apiClient'

export type CollaborativeViewScope = 'personal' | 'team'
export type CollaborativeViewSyncStatus = 'loading' | 'synced' | 'saving' | 'unsaved' | 'offline' | 'conflict'

export interface CollaborativeSavedView<TConfig = Record<string, unknown>> {
  id: string
  name: string
  config: TConfig
  scope?: CollaborativeViewScope
  ownerUserId?: string
  teamId?: number | null
  revision?: number
  schemaVersion?: number
  isFavorite?: boolean
  isDefault?: boolean
  source?: 'system' | 'remote' | 'local'
}

export interface WorkspaceViewApiRecord<TConfig = Record<string, unknown>> {
  id: number
  workspace_key: string
  name: string
  scope: CollaborativeViewScope
  owner_user_id: string
  team_id: number | null
  definition: TConfig
  schema_version: number
  revision: number
  is_favorite?: boolean
  is_default?: boolean
  created_at?: string | null
  updated_at?: string | null
}

export interface WorkspaceViewConflict<TConfig = Record<string, unknown>> {
  message: string
  current: CollaborativeSavedView<TConfig>
}

export interface CollaborativeViewMutationResult<TView> {
  view?: TView
  persisted: boolean
  conflict?: boolean
  error?: string
}

const MAX_LOCAL_MIGRATION_VIEWS = 50

function canonicalizeWorkspaceColumnLayout(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  const canonical: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const source = entry as Record<string, unknown>
    const colId = source.colId
    if (typeof colId !== 'string' || seen.has(colId)) continue
    seen.add(colId)
    const next: Record<string, unknown> = { colId }
    if (typeof source.hide === 'boolean') next.hide = source.hide
    if (source.pinned === 'left' || source.pinned === 'right' || source.pinned === null) next.pinned = source.pinned
    if (typeof source.width === 'number' && Number.isFinite(source.width) && source.width >= 40 && source.width <= 2000) {
      next.width = Math.trunc(source.width)
    }
    if (source.sort === 'asc' || source.sort === 'desc') next.sort = source.sort
    canonical.push(next)
  }
  return canonical
}

export function canonicalizeWorkspaceDefinition<TConfig>(
  definition: unknown,
  sanitizeDefinition: (definition: unknown) => TConfig = (value) => value as TConfig,
): TConfig {
  const sanitized = sanitizeDefinition(definition)
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return sanitized
  const record = sanitized as unknown as Record<string, unknown>
  if (!Array.isArray(record.columnLayoutState)) return sanitized
  return {
    ...record,
    columnLayoutState: canonicalizeWorkspaceColumnLayout(record.columnLayoutState),
  } as unknown as TConfig
}

export function workspaceViewErrorMessage(error: any): string {
  const detail = error?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (detail && typeof detail === 'object' && typeof detail.message === 'string') return detail.message
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  return 'Saved view request failed.'
}

export function isWorkspaceViewOfflineError(error: any): boolean {
  const numericStatus = Number(error?.status)
  return !Number.isFinite(numericStatus) || numericStatus === 0 || numericStatus >= 500
}

export function normalizeWorkspaceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeWorkspaceValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeWorkspaceValue(entry)])
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  return value
}

export function workspaceDefinitionsEqual(left: unknown, right: unknown) {
  return JSON.stringify(normalizeWorkspaceValue(left)) === JSON.stringify(normalizeWorkspaceValue(right))
}

export function isRemoteWorkspaceViewId(id: string | null | undefined): boolean {
  return Boolean(id && /^\d+$/.test(id))
}

export function buildWorkspaceViewLink(href: string, viewId: string | null): string {
  const url = new URL(href)
  if (viewId) url.searchParams.set('view', viewId)
  else url.searchParams.delete('view')
  return url.toString()
}

export function readWorkspaceViewId(href: string): string | null {
  try {
    const value = new URL(href).searchParams.get('view')
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

export function buildWorkspaceViewsListPath(
  workspaceKey: string,
  scope: CollaborativeViewScope = 'personal',
  teamId: number | null = null,
): string {
  const path = `/api/v1/workspaces/${workspaceKey}/views`
  if (scope === 'personal') return path
  const params = new URLSearchParams({ scope: 'team' })
  if (teamId !== null) params.set('team_id', String(teamId))
  return `${path}?${params.toString()}`
}

export function mapWorkspaceViewRecord<TConfig>(
  record: WorkspaceViewApiRecord<TConfig>,
  sanitizeDefinition: (definition: unknown) => TConfig = (definition) => definition as TConfig,
): CollaborativeSavedView<TConfig> {
  return {
    id: String(record.id),
    name: record.name,
    config: canonicalizeWorkspaceDefinition(record.definition, sanitizeDefinition),
    scope: record.scope,
    ownerUserId: record.owner_user_id,
    teamId: record.team_id,
    revision: record.revision,
    schemaVersion: record.schema_version,
    isFavorite: record.is_favorite,
    isDefault: record.is_default,
    source: 'remote',
  }
}

export function mergeCollaborativeViews<
  TConfig,
  TView extends CollaborativeSavedView<TConfig>,
>(
  current: TView[],
  remote: TView[],
  systemViewIds: ReadonlySet<string>,
  normalizeViews: (views: TView[]) => TView[],
): TView[] {
  const system = current.filter((view) => systemViewIds.has(view.id))
  const localOnly = current.filter((view) => !systemViewIds.has(view.id) && !isRemoteWorkspaceViewId(view.id))
  const remoteNames = new Set(remote.map((view) => view.name.trim().toLocaleLowerCase()))
  const remainingLocal = localOnly.filter((view) => !remoteNames.has(view.name.trim().toLocaleLowerCase()))
  return normalizeViews([...system, ...remote, ...remainingLocal])
}

export function parseWorkspaceViewConflict<TConfig>(
  error: any,
  sanitizeDefinition: (definition: unknown) => TConfig = (definition) => definition as TConfig,
): WorkspaceViewConflict<TConfig> | null {
  if (Number(error?.status) !== 409) return null
  const detail = error?.data?.detail
  const current = detail?.current
  if (!current || typeof current !== 'object' || current.id == null) return null
  return {
    message: String(detail?.message || 'Saved view changed on the server.'),
    current: mapWorkspaceViewRecord(current as WorkspaceViewApiRecord<TConfig>, sanitizeDefinition),
  }
}

function localFallbackView<TConfig>(name: string, config: TConfig): CollaborativeSavedView<TConfig> {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    config,
    scope: 'personal',
    revision: 0,
    schemaVersion: 1,
    source: 'local',
  }
}

export function useCollaborativeWorkspaceViews<
  TConfig,
  TView extends CollaborativeSavedView<TConfig>,
>({
  workspaceKey,
  migrationKey,
  scope = 'personal',
  teamId = null,
  systemViewIds,
  currentViews,
  setCurrentViews,
  normalizeViews,
  sanitizeDefinition,
  activeViewId,
  onActiveViewIdChange,
  currentDefinition,
}: {
  workspaceKey: string
  migrationKey: string
  scope?: CollaborativeViewScope
  teamId?: number | null
  systemViewIds: ReadonlySet<string>
  currentViews: TView[]
  setCurrentViews: Dispatch<SetStateAction<TView[]>>
  normalizeViews: (views: TView[]) => TView[]
  sanitizeDefinition: (definition: unknown) => TConfig
  activeViewId: string | null
  onActiveViewIdChange?: (id: string | null) => void
  currentDefinition: TConfig
}) {
  const currentViewsRef = useRef(currentViews)
  const copyInFlight = useRef(false)
  const [copyingLink, setCopyingLink] = useState(false)
  const copyNoticeId = useId()
  // Only successes share a slot. Errors and undo actions retain their own notices.
  const successNoticeId = useId()
  const activeViewIdRef = useRef(activeViewId)
  const [baseStatus, setBaseStatus] = useState<Exclude<CollaborativeViewSyncStatus, 'unsaved' | 'conflict'>>('loading')
  const [conflict, setConflict] = useState<WorkspaceViewConflict<TConfig> | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [requestedViewId, setRequestedViewId] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : readWorkspaceViewId(window.location.href)
  ))

  useEffect(() => {
    currentViewsRef.current = currentViews
  }, [currentViews])

  useEffect(() => {
    activeViewIdRef.current = activeViewId
  }, [activeViewId])

  const setMergedViews = useCallback((remoteViews: TView[]) => {
    setCurrentViews((current) => mergeCollaborativeViews(current, remoteViews, systemViewIds, normalizeViews))
  }, [normalizeViews, setCurrentViews, systemViewIds])

  const createRemote = useCallback(async (name: string, config: TConfig) => {
    const response = await apiClient.post(`/api/v1/workspaces/${workspaceKey}/views`, {
      name,
      scope,
      team_id: scope === 'team' ? teamId : null,
      definition: canonicalizeWorkspaceDefinition(config, sanitizeDefinition),
      schema_version: 1,
    }) as WorkspaceViewApiRecord<TConfig>
    return mapWorkspaceViewRecord(response, sanitizeDefinition) as TView
  }, [sanitizeDefinition, scope, teamId, workspaceKey])

  const hydrate = useCallback(async () => {
    setBaseStatus('loading')
    try {
      const payload = await apiClient.get(buildWorkspaceViewsListPath(workspaceKey, scope, teamId)) as { views?: WorkspaceViewApiRecord<TConfig>[] }
      let remoteViews = Array.isArray(payload?.views)
        ? payload.views.map((record) => mapWorkspaceViewRecord(record, sanitizeDefinition) as TView)
        : []
      let migratedActiveViewId: string | null = null

      const activeId = activeViewIdRef.current
      const activeLocalView = activeId && !systemViewIds.has(activeId) && !isRemoteWorkspaceViewId(activeId)
        ? currentViewsRef.current.find((view) => view.id === activeId) || null
        : null
      if (activeLocalView) {
        const matchingRemote = remoteViews.find((view) => (
          view.name.trim().toLocaleLowerCase() === activeLocalView.name.trim().toLocaleLowerCase()
        ))
        if (matchingRemote) migratedActiveViewId = matchingRemote.id
      }

      const migrationComplete = scope === 'team' || (typeof window !== 'undefined' && window.localStorage.getItem(migrationKey) === '1')
      if (!migrationComplete) {
        const existingNames = new Set(remoteViews.map((view) => view.name.trim().toLocaleLowerCase()))
        const candidates = currentViewsRef.current
          .filter((view) => !systemViewIds.has(view.id) && !isRemoteWorkspaceViewId(view.id))
          .filter((view) => !existingNames.has(view.name.trim().toLocaleLowerCase()))
          .slice(0, MAX_LOCAL_MIGRATION_VIEWS)
        const migrated: TView[] = []
        for (const candidate of candidates) {
          const migratedView = await createRemote(candidate.name, candidate.config)
          migrated.push(migratedView)
          if (candidate.id === activeId) migratedActiveViewId = migratedView.id
        }
        remoteViews = [...remoteViews, ...migrated]
        if (scope === 'personal' && typeof window !== 'undefined') window.localStorage.setItem(migrationKey, '1')
      }

      setMergedViews(remoteViews)
      if (migratedActiveViewId && migratedActiveViewId !== activeId) {
        onActiveViewIdChange?.(migratedActiveViewId)
      }
      setConflict(null)
      setLastError(null)
      setBaseStatus('synced')
    } catch (error: any) {
      setLastError(workspaceViewErrorMessage(error))
      setBaseStatus(isWorkspaceViewOfflineError(error) ? 'offline' : 'synced')
    }
  }, [createRemote, migrationKey, onActiveViewIdChange, scope, setMergedViews, systemViewIds, teamId, workspaceKey])

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePopState = () => setRequestedViewId(readWorkspaceViewId(window.location.href))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const createView = useCallback(async (name: string, config: TConfig): Promise<CollaborativeViewMutationResult<TView>> => {
    setBaseStatus('saving')
    try {
      const remote = await createRemote(name, config)
      setCurrentViews((current) => normalizeViews([...current, remote]))
      setConflict(null)
      setLastError(null)
      setBaseStatus('synced')
      return { view: remote, persisted: true }
    } catch (error: any) {
      const message = workspaceViewErrorMessage(error)
      setLastError(message)
      if (!isWorkspaceViewOfflineError(error)) {
        setBaseStatus('synced')
        return { persisted: false, error: message }
      }
      if (scope === 'team') {
        setBaseStatus('offline')
        return { persisted: false, error: message }
      }
      const fallback = localFallbackView(name, canonicalizeWorkspaceDefinition(config, sanitizeDefinition)) as TView
      setCurrentViews((current) => normalizeViews([...current, fallback]))
      setBaseStatus('offline')
      return { view: fallback, persisted: false, error: message }
    }
  }, [createRemote, normalizeViews, sanitizeDefinition, setCurrentViews])

  const updateView = useCallback(async (
    id: string,
    name: string,
    config: TConfig,
  ): Promise<CollaborativeViewMutationResult<TView>> => {
    const existing = currentViewsRef.current.find((view) => view.id === id)
    if (!existing) return { persisted: false }

    if (systemViewIds.has(id)) {
      const local = { ...existing, name, config: canonicalizeWorkspaceDefinition(config, sanitizeDefinition), source: 'system' } as TView
      setCurrentViews((current) => normalizeViews(current.map((view) => view.id === id ? local : view)))
      setBaseStatus('synced')
      return { view: local, persisted: true }
    }

    if (!isRemoteWorkspaceViewId(id) || !existing.revision) {
      setBaseStatus('saving')
      try {
        const remote = await createRemote(name, config)
        setCurrentViews((current) => normalizeViews(current.map((view) => view.id === id ? remote : view)))
        setLastError(null)
        setBaseStatus('synced')
        return { view: remote, persisted: true }
      } catch (error: any) {
        const message = workspaceViewErrorMessage(error)
        setLastError(message)
        if (!isWorkspaceViewOfflineError(error)) {
          setBaseStatus('synced')
          return { persisted: false, error: message }
        }
        if (scope === 'team') {
          setBaseStatus('offline')
          return { persisted: false, error: message }
        }
        const local = { ...existing, name, config: canonicalizeWorkspaceDefinition(config, sanitizeDefinition), source: 'local' } as TView
        setCurrentViews((current) => normalizeViews(current.map((view) => view.id === id ? local : view)))
        setBaseStatus('offline')
        return { view: local, persisted: false, error: message }
      }
    }

    setBaseStatus('saving')
    try {
      const targetScope = existing.scope || scope
      const targetTeamId = targetScope === 'team' ? (existing.teamId ?? teamId) : null
      const response = await apiClient.put(`/api/v1/workspaces/views/${id}`, {
        name,
        scope: targetScope,
        team_id: targetTeamId,
        definition: canonicalizeWorkspaceDefinition(config, sanitizeDefinition),
        schema_version: existing.schemaVersion || 1,
        revision: existing.revision,
      }) as WorkspaceViewApiRecord<TConfig>
      const remote = mapWorkspaceViewRecord(response, sanitizeDefinition) as TView
      setCurrentViews((current) => normalizeViews(current.map((view) => view.id === id ? remote : view)))
      setConflict(null)
      setLastError(null)
      setBaseStatus('synced')
      return { view: remote, persisted: true }
    } catch (error: any) {
      const nextConflict = parseWorkspaceViewConflict<TConfig>(error, sanitizeDefinition)
      if (nextConflict) {
        setConflict(nextConflict)
        setLastError(nextConflict.message)
        setBaseStatus('synced')
        return { persisted: false, conflict: true }
      }
      const message = workspaceViewErrorMessage(error)
      setLastError(message)
      setBaseStatus(isWorkspaceViewOfflineError(error) ? 'offline' : 'synced')
      return { persisted: false, error: message }
    }
  }, [createRemote, normalizeViews, sanitizeDefinition, scope, setCurrentViews, systemViewIds, teamId])

  const deleteView = useCallback(async (id: string): Promise<CollaborativeViewMutationResult<TView>> => {
    const existing = currentViewsRef.current.find((view) => view.id === id)
    if (!existing || systemViewIds.has(id)) return { persisted: false }

    if (!isRemoteWorkspaceViewId(id) || !existing.revision) {
      setCurrentViews((current) => normalizeViews(current.filter((view) => view.id !== id)))
      return { persisted: false }
    }

    setBaseStatus('saving')
    try {
      await apiClient.delete(`/api/v1/workspaces/views/${id}?revision=${existing.revision}`)
      setCurrentViews((current) => normalizeViews(current.filter((view) => view.id !== id)))
      setConflict(null)
      setLastError(null)
      setBaseStatus('synced')
      return { persisted: true }
    } catch (error: any) {
      const nextConflict = parseWorkspaceViewConflict<TConfig>(error, sanitizeDefinition)
      if (nextConflict) {
        setConflict(nextConflict)
        setLastError(nextConflict.message)
        setBaseStatus('synced')
        return { persisted: false, conflict: true }
      }
      const message = workspaceViewErrorMessage(error)
      setLastError(message)
      setBaseStatus(isWorkspaceViewOfflineError(error) ? 'offline' : 'synced')
      return { persisted: false, error: message }
    }
  }, [normalizeViews, sanitizeDefinition, setCurrentViews, systemViewIds])

  const reloadConflict = useCallback(() => {
    if (!conflict) return
    const next = conflict.current as TView
    setCurrentViews((current) => normalizeViews(current.map((view) => view.id === next.id ? next : view)))
    setConflict(null)
    setLastError(null)
    setBaseStatus('synced')
  }, [conflict, normalizeViews, setCurrentViews])

  const saveConflictCopy = useCallback(async () => {
    if (!conflict) return { persisted: false } as CollaborativeViewMutationResult<TView>
    const existing = currentViewsRef.current.find((view) => view.id === conflict.current.id)
    if (!existing) return { persisted: false } as CollaborativeViewMutationResult<TView>
    const result = await createView(`${existing.name} copy`, existing.config)
    if (result.view) setConflict(null)
    return result
  }, [conflict, createView])

  const setViewLink = useCallback((viewId: string | null) => {
    if (typeof window === 'undefined') return ''
    const link = buildWorkspaceViewLink(window.location.href, viewId)
    window.history.replaceState(window.history.state, '', link)
    setRequestedViewId(viewId)
    return link
  }, [])

  const copyViewLink = useCallback(async (viewId: string | null) => {
    if (copyInFlight.current) return ''
    const link = setViewLink(viewId)
    if (!link) return ''
    copyInFlight.current = true
    setCopyingLink(true)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(link)
      toast.remove(copyNoticeId)
      toast.success('View link copied', { id: successNoticeId })
    } catch {
      toast.error('Could not copy the view link. Copy the URL from your address bar.', { id: copyNoticeId })
    } finally {
      copyInFlight.current = false
      setCopyingLink(false)
    }
    return link
  }, [copyNoticeId, successNoticeId, setViewLink])

  const activeView = useMemo(() => (
    activeViewId ? currentViews.find((view) => view.id === activeViewId) || null : null
  ), [activeViewId, currentViews])
  const dirty = Boolean(activeView && !workspaceDefinitionsEqual(
    canonicalizeWorkspaceDefinition(currentDefinition, sanitizeDefinition),
    canonicalizeWorkspaceDefinition(activeView.config, sanitizeDefinition),
  ))
  const status: CollaborativeViewSyncStatus = conflict
    ? 'conflict'
    : baseStatus === 'loading' || baseStatus === 'saving' || baseStatus === 'offline'
      ? baseStatus
      : dirty
        ? 'unsaved'
        : 'synced'

  return {
    status,
    copyingLink,
    successNoticeId,
    conflict,
    lastError,
    dirty,
    requestedViewId,
    hydrate,
    createView,
    updateView,
    deleteView,
    reloadConflict,
    saveConflictCopy,
    setViewLink,
    copyViewLink,
  } as const
}
