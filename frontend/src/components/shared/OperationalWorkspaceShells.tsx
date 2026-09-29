import React from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, ChevronDown, ChevronUp, CloudOff, Copy, Pencil, RefreshCcw, Save, Trash2, X } from 'lucide-react'
import { AppDropdown } from './AppDropdown'
import { PageHeader } from './LayoutPrimitives'
import { WorkspaceCommandBar } from './WorkspaceCommandBar'
import { WorkspaceFloatingPanel } from './OperationalWorkspacePrimitives'

const join = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')
type WorkspaceFilterChip = { id: string; label: string; onRemove: () => void }
export type GoldenWorkspaceArchetype = 'table' | 'hybrid' | 'analytical'

export const GOLDEN_WORKSPACE_GEOMETRY_VERSION = '1'
export const GOLDEN_WORKSPACE_FRAME_CLASS = 'h-full min-h-0 flex flex-col space-y-4'
export const GOLDEN_GRID_BASE_CLASS = 'operational-grid-shell operational-grid flex flex-1 w-full min-h-0 flex-col glass-panel overflow-hidden ag-theme-alpine-dark relative'
export const GOLDEN_GRID_VARIANT_CLASS = {
  golden: 'rounded-lg',
  'attached-panel': 'rounded-t-none border-x border-b border-white/5',
} as const

export const getOperationalGridSurfaceStyle = (
  fontSize: number,
  height?: string
): React.CSSProperties => ({
  '--ag-font-size': `${fontSize}px`,
  '--ag-font-family': "'Inter', sans-serif",
  minHeight: '350px',
  ...(height ? { height } : {}),
} as React.CSSProperties)

export function OperationalWorkspaceFrame({
  header,
  commandBar,
  children,
  className = '',
  workspace,
  archetype = 'table',
}: {
  header: React.ComponentProps<typeof PageHeader>
  commandBar: React.ComponentProps<typeof WorkspaceCommandBar>
  children: React.ReactNode
  className?: string
  workspace?: string
  archetype?: GoldenWorkspaceArchetype
}) {
  return (
    <div
      className={join(GOLDEN_WORKSPACE_FRAME_CLASS, className)}
      data-workspace={workspace}
      data-golden-workspace-shell="true"
      data-golden-workspace={workspace}
      data-golden-archetype={archetype}
      data-golden-geometry-version={GOLDEN_WORKSPACE_GEOMETRY_VERSION}
    >
      <PageHeader {...header} />
      <WorkspaceCommandBar {...commandBar} />
      {children}
    </div>
  )
}

export function OperationalWorkspaceShell({
  header,
  commandBar,
  toolbarSearch,
  toolbarControls,
  toolbarActions,
  secondaryToolbar,
  filterChips,
  floatingPanels,
  children,
  className = '',
  workspace,
  archetype = 'table',
}: {
  header: React.ComponentProps<typeof PageHeader>
  commandBar?: React.ComponentProps<typeof WorkspaceCommandBar>
  toolbarSearch?: React.ReactNode
  toolbarControls?: React.ReactNode
  toolbarActions?: React.ReactNode
  secondaryToolbar?: React.ReactNode
  filterChips?: WorkspaceFilterChip[]
  floatingPanels?: React.ReactNode
  children: React.ReactNode
  className?: string
  workspace?: string
  archetype?: GoldenWorkspaceArchetype
}) {
  const resolvedCommandBar = commandBar ?? {
    left: toolbarSearch,
    controls: toolbarControls,
    right: toolbarActions,
    secondary: secondaryToolbar,
    filterChips,
  }

  return (
    <OperationalWorkspaceFrame header={header} commandBar={resolvedCommandBar} className={className} workspace={workspace} archetype={archetype}>
      {typeof document !== 'undefined' && floatingPanels ? createPortal(floatingPanels, document.body) : null}
      {children}
    </OperationalWorkspaceFrame>
  )
}

export function OperationalGridSurface({
  children,
  className = '',
  style,
  loading,
  loadingIcon,
  loadingLabel,
  variant = 'golden',
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  loading?: boolean
  loadingIcon?: React.ReactNode
  loadingLabel?: React.ReactNode
  variant?: 'golden' | 'attached-panel'
}) {
  return (
    <div className={join(
      GOLDEN_GRID_BASE_CLASS,
      GOLDEN_GRID_VARIANT_CLASS[variant],
      className
    )} style={style} data-golden-grid-surface="true" data-golden-grid-variant={variant} data-golden-geometry-version={GOLDEN_WORKSPACE_GEOMETRY_VERSION}>
      {loading ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#020617]/80 backdrop-blur-sm space-y-4">
          {loadingIcon}
          {loadingLabel}
        </div>
      ) : null}
      {children}
    </div>
  )
}

export function OperationalAnchoredPanel({
  isOpen,
  panelKey,
  style,
  className = '',
  panelRef,
  children,
  yOffset = 8,
  interactionLocked = false,
}: {
  isOpen: boolean
  panelKey: string
  style: React.CSSProperties
  className?: string
  panelRef?: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
  yOffset?: number
  interactionLocked?: boolean
}) {
  if (!isOpen) return null

  return (
    <div
      ref={panelRef}
      style={style}
      className={className}
      data-workspace-panel="true"
      data-workspace-panel-key={panelKey}
      data-workspace-panel-offset={yOffset}
      data-workspace-interaction-lock={interactionLocked ? 'true' : undefined}
    >
      {children}
    </div>
  )
}

export function OperationalGroupedGridView({
  summary,
  actions,
  sections,
}: {
  summary: React.ReactNode
  actions?: React.ReactNode
  sections: React.ReactNode
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 custom-scrollbar">
      <div className="rounded-lg border border-white/5 bg-black/20 px-6 py-4 flex items-center justify-between">
        {summary}
        {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
      </div>
      {sections}
    </div>
  )
}

export function OperationalGroupedGridSection({
  labelMeta,
  label,
  count,
  countLabel,
  selectedCount,
  collapsed,
  onToggle,
  children,
}: {
  labelMeta: React.ReactNode
  label: React.ReactNode
  count: number
  countLabel: string
  selectedCount?: number
  collapsed: boolean
  onToggle: () => void
  children?: React.ReactNode
}) {
  return (
    <section className="glass-panel overflow-hidden rounded-lg border border-white/5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 border-b border-white/5 bg-white/[0.03] px-5 py-4 text-left transition-all hover:bg-white/[0.05]"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            {labelMeta}
            <h3 className="text-sm font-semibold text-slate-100">{label}</h3>
          </div>
          <p className="pt-1 text-[11px] text-slate-400">{count} {countLabel}{selectedCount ? ` · ${selectedCount} selected` : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-lg border border-white/5 bg-black/30 px-2.5 py-1 text-[9px] font-semibold text-slate-300">{count}</span>
          {collapsed ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronUp size={16} className="text-slate-500" />}
        </div>
      </button>
      {children}
    </section>
  )
}

export function OperationalDisplayPanel({
  isOpen,
  panelStyle,
  panelRef,
  title = 'Display density',
  onClose,
  fontSize,
  onFontSizeChange,
  rowDensity,
  onRowDensityChange,
  groupBy,
  onGroupByChange,
  groupOptions,
  columns,
  hiddenColumns,
  onToggleColumn,
}: {
  isOpen: boolean
  panelStyle: React.CSSProperties
  panelRef?: React.RefObject<HTMLDivElement | null>
  title?: string
  onClose: () => void
  fontSize: number
  onFontSizeChange: (value: number) => void
  rowDensity: number
  onRowDensityChange: (value: number) => void
  groupBy?: string
  onGroupByChange?: (value: string) => void
  groupOptions?: Array<{ value: string; label: string }>
  columns: Array<{ field?: string; headerName?: string; lockVisible?: boolean }>
  hiddenColumns: string[]
  onToggleColumn: (field: string) => void
}) {
  const showGrouping = Boolean(groupOptions?.length && groupBy != null && onGroupByChange)

  return (
    <OperationalAnchoredPanel
      isOpen={isOpen}
      panelKey="display-menu"
      style={panelStyle}
      panelRef={panelRef}
      className="display-menu-container"
    >
      <WorkspaceFloatingPanel kind="menu" className="p-4">
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-400">{title}</span>
              <button onClick={onClose} className="text-slate-500 hover:text-white">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-3 rounded-lg border border-white/5 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[10px] font-semibold text-slate-400">Font</span>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="8"
                    max="14"
                    step="1"
                    value={fontSize}
                    onChange={(event) => onFontSizeChange(Number(event.target.value))}
                    className="h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-slate-800 accent-blue-500"
                  />
                  <span className="w-8 text-right text-[10px] font-black tabular-nums text-white">{fontSize}px</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[10px] font-semibold text-slate-400">Rows</span>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="2"
                    value={rowDensity}
                    onChange={(event) => onRowDensityChange(Number(event.target.value))}
                    className="h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-slate-800 accent-blue-500"
                  />
                  <span className="w-8 text-right text-[10px] font-black tabular-nums text-white">{rowDensity}px</span>
                </div>
              </div>
            </div>
          </div>

          {showGrouping ? (
            <div className="space-y-2">
              <AppDropdown
                value={groupBy as string}
                onChange={onGroupByChange as (value: string | string[]) => void}
                options={groupOptions as Array<{ value: string; label: string }>}
                label="Group By"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <span className="text-[10px] font-semibold text-slate-400">Columns</span>
            <div className="max-h-[240px] space-y-1 overflow-y-auto pr-1 custom-scrollbar">
              {columns.filter((column) => column.field && !column.lockVisible).map((column) => {
                const field = column.field as string
                const visible = !hiddenColumns.includes(field)
                return (
                  <label key={field} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-all hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={() => onToggleColumn(field)}
                      className="sr-only"
                    />
                    <div className={`flex h-4 w-4 items-center justify-center rounded-lg border transition-all ${visible ? 'bg-blue-600 border-blue-500' : 'border-white/10 bg-black/40'}`}>
                      {visible ? <Check size={11} className="text-white" /> : null}
                    </div>
                    <span className={`text-[10px] font-semibold ${visible ? 'text-slate-200' : 'text-slate-500'}`}>
                      {column.headerName || field}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      </WorkspaceFloatingPanel>
    </OperationalAnchoredPanel>
  )
}

export function OperationalSavedViewsPanel<TView extends {
  id: string
  name: string
  config?: { groupBy?: string }
  scope?: 'personal' | 'team'
  source?: 'system' | 'remote' | 'local'
}>({
  isOpen,
  panelStyle,
  panelRef,
  entityLabel,
  onClose,
  activeViewId,
  currentViewName,
  newViewName,
  onNewViewNameChange,
  onCreateView,
  onApplySystemDefault,
  savedViews,
  defaultViewIds,
  onApplyView,
  onOverwriteView,
  onRenameView,
  onDeleteView,
  describeView,
  syncStatus,
  syncMessage,
  onCopyViewLink,
  conflictMessage,
  onReloadConflict,
  onSaveConflictCopy,
}: {
  isOpen: boolean
  panelStyle: React.CSSProperties
  panelRef?: React.RefObject<HTMLDivElement | null>
  entityLabel: string
  onClose: () => void
  activeViewId: string | null
  currentViewName: string
  newViewName: string
  onNewViewNameChange: (value: string) => void
  onCreateView: () => void
  onApplySystemDefault: () => void
  savedViews: TView[]
  defaultViewIds: Set<string>
  onApplyView: (id: string) => void
  onOverwriteView: (id: string) => void
  onRenameView?: (id: string, name: string) => Promise<boolean> | boolean
  onDeleteView: (id: string) => void
  describeView: (view: TView) => string
  syncStatus?: 'loading' | 'synced' | 'saving' | 'unsaved' | 'offline' | 'conflict'
  syncMessage?: string
  onCopyViewLink?: (id: string | null) => void
  conflictMessage?: string
  onReloadConflict?: () => void
  onSaveConflictCopy?: () => void
}) {
  const [confirmingDeleteViewId, setConfirmingDeleteViewId] = React.useState<string | null>(null)
  const [renamingViewId, setRenamingViewId] = React.useState<string | null>(null)
  const [renameCanSubmit, setRenameCanSubmit] = React.useState(false)
  const [renamePendingViewId, setRenamePendingViewId] = React.useState<string | null>(null)
  const renamePendingViewIdRef = React.useRef<string | null>(null)
  const renameDraftRef = React.useRef('')
  const renameInputRef = React.useRef<HTMLInputElement | null>(null)

  const clearRenameEditor = React.useCallback(() => {
    renamePendingViewIdRef.current = null
    renameDraftRef.current = ''
    setRenamingViewId(null)
    setRenameCanSubmit(false)
    setRenamePendingViewId(null)
  }, [])

  const submitRename = React.useCallback(async (view: TView) => {
    if (!onRenameView || renamePendingViewIdRef.current) return
    const nextName = (renameInputRef.current?.value ?? renameDraftRef.current).trim()
    if (!nextName) return

    renamePendingViewIdRef.current = view.id
    renameDraftRef.current = nextName
    setRenameCanSubmit(true)
    setRenamePendingViewId(view.id)
    let persisted = false
    try {
      persisted = await onRenameView(view.id, nextName)
    } catch {
      persisted = false
    } finally {
      if (renamePendingViewIdRef.current === view.id) {
        renamePendingViewIdRef.current = null
        setRenamePendingViewId(null)
      }
    }

    if (persisted) clearRenameEditor()
  }, [clearRenameEditor, onRenameView])

  React.useEffect(() => {
    if (isOpen) return
    setConfirmingDeleteViewId(null)
    clearRenameEditor()
  }, [clearRenameEditor, isOpen])

  const collaborativeEnabled = syncStatus !== undefined
  const resolvedSyncStatus = syncStatus ?? 'synced'
  const statusMeta = {
    loading: { label: 'Loading', className: 'border-slate-500/20 bg-slate-500/10 text-slate-300', icon: <RefreshCcw size={11} className="animate-spin" /> },
    synced: { label: 'Synced', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300', icon: <Check size={11} /> },
    saving: { label: 'Saving', className: 'border-blue-500/20 bg-blue-500/10 text-blue-300', icon: <RefreshCcw size={11} className="animate-spin" /> },
    unsaved: { label: 'Unsaved', className: 'border-amber-500/20 bg-amber-500/10 text-amber-300', icon: <AlertTriangle size={11} /> },
    offline: { label: 'Offline fallback', className: 'border-orange-500/20 bg-orange-500/10 text-orange-300', icon: <CloudOff size={11} /> },
    conflict: { label: 'Conflict', className: 'border-rose-500/20 bg-rose-500/10 text-rose-300', icon: <AlertTriangle size={11} /> },
  }[resolvedSyncStatus]

  return (
    <OperationalAnchoredPanel
      isOpen={isOpen}
      panelKey="views-menu"
      style={panelStyle}
      panelRef={panelRef}
      className="views-menu-container"
      interactionLocked={renamingViewId !== null}
    >
      <WorkspaceFloatingPanel kind="menu" className={collaborativeEnabled ? 'w-[min(440px,calc(100vw-24px))] max-w-full p-4' : 'p-4'}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold text-slate-400">Saved views</p>
                {collaborativeEnabled ? (
                  <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[9px] font-semibold ${statusMeta.className}`} data-testid="workspace-view-sync-status">
                    {statusMeta.icon}
                    {statusMeta.label}
                  </span>
                ) : null}
              </div>
              <p className="pt-1 text-[11px] text-slate-400">{collaborativeEnabled ? `Load, save, and share complete ${entityLabel} layouts.` : `Load, save, and overwrite full ${entityLabel} layouts.`}</p>
              {syncMessage ? <p className="pt-1 text-[10px] text-slate-500">{syncMessage}</p> : null}
            </div>
            <button
              onClick={onClose}
              disabled={renamePendingViewId !== null}
              className="shrink-0 text-slate-500 hover:text-white disabled:cursor-wait disabled:opacity-40"
              aria-label="Close saved views"
            >
              <X size={14} />
            </button>
          </div>

          {collaborativeEnabled && resolvedSyncStatus === 'conflict' ? (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/8 p-3" role="alert">
              <p className="text-[10px] font-semibold text-rose-300">{conflictMessage || 'This view changed on the server.'}</p>
              <p className="pt-1 text-[10px] text-slate-400">Reload the server copy or preserve your current layout as a personal copy.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={onReloadConflict} className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] font-semibold text-rose-200 hover:bg-rose-500/20">
                  Reload server copy
                </button>
                <button type="button" onClick={onSaveConflictCopy} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-semibold text-slate-200 hover:bg-white/[0.08]">
                  Save personal copy
                </button>
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-white/5 bg-black/20 p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-slate-400">Current view</p>
                <p className="truncate pt-1 text-[11px] font-semibold text-slate-100">{currentViewName}</p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {collaborativeEnabled && onCopyViewLink ? (
                  <button
                    type="button"
                    onClick={() => onCopyViewLink(activeViewId)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-semibold text-slate-200 transition-all hover:bg-white/[0.08]"
                  >
                    <Copy size={11} />
                    Copy link
                  </button>
                ) : null}
                {activeViewId ? (
                  <button
                    type="button"
                    onClick={() => onOverwriteView(activeViewId)}
                    className="rounded-lg border border-blue-500/20 bg-blue-600/15 px-3 py-2 text-[10px] font-semibold text-blue-200 transition-all hover:bg-blue-600/25"
                  >
                    {collaborativeEnabled ? 'Save current' : 'Overwrite Current'}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={newViewName}
                onChange={(event) => onNewViewNameChange(event.target.value)}
                placeholder={collaborativeEnabled ? 'Save as new personal view...' : 'Save as new view...'}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-semibold text-white outline-none transition-all placeholder:text-slate-600 focus:border-blue-500/40"
              />
              <button
                type="button"
                onClick={onCreateView}
                disabled={collaborativeEnabled && (resolvedSyncStatus === 'saving' || resolvedSyncStatus === 'loading')}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-semibold text-slate-200 transition-all hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {collaborativeEnabled ? 'Save personal view' : 'Save New'}
              </button>
            </div>
          </div>

          <div className={collaborativeEnabled ? 'max-h-[min(430px,55vh)] space-y-2 overflow-y-auto rounded-lg border border-white/5 bg-black/20 p-3 custom-scrollbar' : 'space-y-2 rounded-lg border border-white/5 bg-black/20 p-3'}>
            <button
              onClick={onApplySystemDefault}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${
                activeViewId === null
                  ? 'border-emerald-500/30 bg-emerald-500/12'
                  : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className={`text-[10px] font-semibold ${activeViewId === null ? 'text-emerald-300' : 'text-slate-200'}`}>System default</p>
                  <p className="pt-1 text-[10px] text-slate-500">{collaborativeEnabled ? 'Standard layout with no personal override' : 'Standard table layout with no active view'}</p>
                </div>
                <span className="text-[9px] font-semibold text-slate-500">Core</span>
              </div>
            </button>

            {savedViews.map((view) => {
              const isDefaultView = defaultViewIds.has(view.id)
              const isConfirming = confirmingDeleteViewId === view.id
              const isRenaming = renamingViewId === view.id
              const isRenamePending = renamePendingViewId === view.id
              const isLocal = view.source === 'local' || view.id.startsWith('local-')
              const scopeLabel = collaborativeEnabled
                ? (isDefaultView || view.source === 'system' ? 'Core' : isLocal ? 'Local fallback' : view.scope === 'team' ? 'Team' : 'Personal')
                : (isDefaultView ? 'Default' : 'Custom')
              return (
                <div key={view.id} className="flex items-stretch gap-2">
                  {isRenaming ? (
                    <div className="min-w-0 flex-1 rounded-lg border border-blue-500/30 bg-blue-500/8 p-2">
                      <label className="text-[9px] font-semibold text-slate-400" htmlFor={`rename-workspace-view-${view.id}`}>Rename personal view</label>
                      <div className="mt-1.5 flex gap-2">
                        <input
                          ref={renameInputRef}
                          id={`rename-workspace-view-${view.id}`}
                          autoFocus
                          defaultValue={renameDraftRef.current || view.name}
                          disabled={isRenamePending}
                          onInput={(event) => {
                            renameDraftRef.current = event.currentTarget.value
                            setRenameCanSubmit(Boolean(event.currentTarget.value.trim()))
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape' && !isRenamePending) {
                              event.preventDefault()
                              clearRenameEditor()
                            }
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void submitRename(view)
                            }
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-[10px] font-semibold text-white outline-none focus:border-blue-500/40 disabled:cursor-wait disabled:opacity-70"
                        />
                        <button
                          type="button"
                          disabled={!renameCanSubmit || isRenamePending}
                          onClick={() => { void submitRename(view) }}
                          className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-300 disabled:cursor-wait disabled:opacity-40"
                          aria-label={`Confirm rename ${view.name}`}
                          aria-busy={isRenamePending}
                        >
                          {isRenamePending ? <RefreshCcw size={12} className="animate-spin" /> : <Check size={12} />}
                        </button>
                        <button
                          type="button"
                          disabled={isRenamePending}
                          onClick={clearRenameEditor}
                          className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-400 hover:text-white disabled:cursor-wait disabled:opacity-40"
                          aria-label={`Cancel rename ${view.name}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => onApplyView(view.id)}
                      className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-left transition-all ${
                        activeViewId === view.id
                          ? 'border-blue-500/30 bg-blue-500/12'
                          : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`truncate text-[10px] font-semibold ${activeViewId === view.id ? 'text-blue-300' : 'text-slate-200'}`}>{view.name}</p>
                          <p className="truncate pt-1 text-[10px] text-slate-500">{describeView(view)}</p>
                        </div>
                        <span className="shrink-0 text-[9px] font-semibold text-slate-500">{scopeLabel}</span>
                      </div>
                    </button>
                  )}
                  {!isRenaming ? (
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        onClick={() => onOverwriteView(view.id)}
                        title={collaborativeEnabled ? `Save current layout to ${view.name}` : `Overwrite ${view.name}`}
                        className="rounded-lg border border-white/8 bg-white/[0.03] p-1.5 text-slate-400 transition-all hover:bg-white/[0.06] hover:text-white"
                      >
                        <Save size={12} />
                      </button>
                      {!isDefaultView && onRenameView ? (
                        <button
                          onClick={() => {
                            renameDraftRef.current = view.name
                            setRenameCanSubmit(Boolean(view.name.trim()))
                            setRenamingViewId(view.id)
                          }}
                          title={`Rename ${view.name}`}
                          className="rounded-lg border border-white/8 bg-white/[0.03] p-1.5 text-slate-400 transition-all hover:bg-white/[0.06] hover:text-white"
                        >
                          <Pencil size={12} />
                        </button>
                      ) : null}
                      {!isDefaultView ? (
                        <button
                          onClick={() => {
                            if (isConfirming) {
                              onDeleteView(view.id)
                              setConfirmingDeleteViewId(null)
                            } else {
                              setConfirmingDeleteViewId(view.id)
                            }
                          }}
                          title={isConfirming ? `Confirm delete ${view.name}` : `Delete ${view.name}`}
                          className={`rounded-lg border p-1.5 transition-all ${
                            isConfirming
                              ? 'border-rose-500 bg-rose-500 text-white'
                              : 'border-rose-500/20 bg-rose-500/5 text-rose-500 hover:bg-rose-500/20'
                          }`}
                        >
                          <Trash2 size={12} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </WorkspaceFloatingPanel>
    </OperationalAnchoredPanel>
  )
}
