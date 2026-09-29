export type WorkspaceCapability =
  | 'savedViews'
  | 'displayControls'
  | 'grouping'
  | 'contextMenu'
  | 'bulkActions'
  | 'hoverPreviews'
  | 'history'
  | 'compare'
  | 'linkedRecords'
  | 'archiveRestore'
  | 'stickyIdentityHeader'
  | 'frontendValidation'
  | 'searchableSelectors'
  | 'deepLinkedDetails'

export interface WorkspaceDefinition {
  workspaceName: string
  standardSurface: string[]
  requiredBaseline: string[]
  gridBehaviorContract: string[]
  modalBehaviorContract: string[]
  sharedCapabilities: WorkspaceCapability[]
  monitoringSpecificFeatures: string[]
}

// Canonical visual tokens extracted from the Monitoring workspace.
// Future operational views should compose these tokens rather than copy raw class strings.
export const OPERATIONAL_WORKSPACE_VISUALS = {
  standardRadius: 'rounded-lg',
  shellRadius: 'rounded-lg',
  panelSurface: 'rounded-lg border border-white/10 bg-white/[0.03]',
  insetSurface: 'rounded-lg border border-white/10 bg-black/20',
  floatingSurface: 'rounded-lg border border-white/10 bg-[#020617]',
  controlSurface: 'rounded-lg border border-[var(--border-default)] bg-[var(--input-bg)]',
  toolbarSurface: 'rounded-lg border border-white/5 bg-white/5',
  titleText: 'text-sm font-black tracking-tight text-slate-100',
  subtitleText: 'text-[10px] font-semibold text-slate-400',
  hintText: 'text-[10px] font-semibold text-slate-500',
  fieldLabelText: 'text-xs font-semibold text-[var(--text-secondary)]',
  fieldErrorText: 'text-xs font-medium text-[var(--state-danger)]',
  bodyControlText: 'text-sm text-[var(--text-primary)]',
  selectionText: 'text-[clamp(11px,0.9vw,13px)] font-black',
} as const

// Monitoring is the source-of-truth operational workspace.
// This checklist is the contract future applicable views should inherit by default.
export const MONITORING_WORKSPACE_STANDARD: WorkspaceDefinition = {
  workspaceName: 'Monitoring',
  standardSurface: [
    'Page header with title, subtitle, actions, and active/archive segmented state',
    'Native command bar with search, views, display controls, export, registry access, and bulk actions',
    'Operational grid with saved views, grouping, column controls, hover previews, and right-click actions',
    'Add/edit workspace with sticky identity header, full-width focused tab content, collapsible cards, inline validation, and consistent action footer',
    'History, compare, and detail dossier flows for versioned operational records using split-view sidebars where context is required',
  ],
  requiredBaseline: [
    'Consistent page header and toolbar shell',
    'Failure, empty, and diagnostic states use shared workspace card surfaces, page header primitives, and native toolbar controls instead of bespoke layouts',
    'Saved views and display controls where the view is table-centric',
    'Add/edit modal with sticky identity fields, focused full-width sections, and inline validation',
    'Hover previews for dense linked data where scan speed matters',
    'Shared native floating panels for menus, context actions, and linked record browsing',
    'History and archive/restore behavior when the entity lifecycle supports it',
    'Shareable internal deep-link access by entity id when the view has a primary detail surface',
  ],
  gridBehaviorContract: [
    'Saved views persist search, filters, grouping, sort, and column visibility together',
    'Saved workspace state is user-scoped and tenant-scoped through backend preferences when the view is operationally important, with local storage treated only as fallback or migration compatibility',
    'Saved views and workspace state must be sanitized against the current column/filter/sort contract before apply so stale column ids never corrupt newer grid definitions',
    'Display controls manage density and column presentation without mutating record data',
    'Default grid layouts auto-size visible content columns when longer data arrives, without overriding fixed utility columns or explicit saved/manual layouts',
    'All operational timestamps render in the app runtime local timezone consistently across grid cells, hover previews, detail surfaces, and history flows',
    'Grouping and right-click actions are available only where the entity benefits from operational table workflows',
    'Bulk actions operate on explicit selection state and never on hidden implicit scope',
    'Hover previews expose dense linked data without forcing modal navigation',
    'Context menus preserve anchor behavior while sharing the same native visual shell',
    'A canonical internal URL contract should open the targeted record detail by unique id for authorized users without requiring manual table search first',
    'Operational import/export must use a schema-versioned round-trip contract so exported snapshots can be re-imported without relying on raw database column names',
  ],
  modalBehaviorContract: [
    'Add/edit uses a sticky identity header for the primary record fields',
    'Focused content areas occupy the full modal width to maximize horizontal scanning in complex forms',
    'Tabbed sections keep validation visible with field errors and tab-level counts',
    'Large workspace and detail modals use standardized dossier-style shells rather than one-off layouts',
    'Sections can collapse without hiding validation context or breaking save flow',
    'Required fields are marked in the form, not only rejected by the backend',
    'The footer keeps cancel and save actions in a consistent location across views',
    'History, compare, and archive/restore appear only when the backing entity supports them',
    'Version history APIs should return canonical structured deltas per version so timeline and compare surfaces do not reverse-engineer snapshot diffs on the client',
    'If a route carries a valid entity id query parameter, the view should restore or open the matching detail surface directly and fail cleanly when the record is missing or unauthorized',
    'Bootstrap and connection-failure surfaces should merge frontend inference with backend-reported startup diagnostics whenever the backend can still answer a diagnostic endpoint',
  ],
  sharedCapabilities: [
    'savedViews',
    'displayControls',
    'grouping',
    'contextMenu',
    'bulkActions',
    'hoverPreviews',
    'history',
    'compare',
    'linkedRecords',
    'archiveRestore',
    'stickyIdentityHeader',
    'frontendValidation',
    'searchableSelectors',
    'deepLinkedDetails',
  ],
  monitoringSpecificFeatures: [
    'Logic editor with syntax-aware CodeMirror behavior',
    'Critical severity recovery-document enforcement',
    'Monitoring platform and frequency guardrail validation',
    'Team-or-individual ownership exclusivity for monitors',
    'Monitoring URL sanitization and safety rules',
  ],
}

export const OPERATIONAL_WORKSPACE_MINIMUM_STANDARD = [
  'Shared page header and toolbar shell',
  'Shared failure, empty, and diagnostic-state surfaces using workspace cards, standard badges, and toolbar actions',
  'Shared header scope switch primitive for top-level dataset modes like Existing/Archived',
  'Shared contextual bulk-action flyout primitives for anchored row-selection actions',
  'Shared table/workspace state model for search, filters, views, selection, and column layout persistence',
  'Shared saved-state sanitization for column layout, hidden columns, filters, and sort definitions before restoring workspace state',
  'Shared internal deep-link contract so entity detail views can be opened directly by unique id from a shareable app URL',
  'Shared operational grid sizing helpers for dynamic default widths and explicit saved/manual widths',
  'Shared add/edit modal shell with sticky identity, tabs, validation, and footer actions',
  'Per-view adapter contract for schema, actions, validation rules, and linked selectors',
] as const

// Adapter shape for future view migrations after schema stabilization.
export interface OperationalWorkspaceAdapter {
  entityLabel: string
  supports: WorkspaceCapability[]
  hasAdvancedEditor?: boolean
  hasLinkedKnowledge?: boolean
  hasVersioning?: boolean
}

export type OperationalRegistrySlotKey =
  | 'columns'
  | 'grid'
  | 'filters'
  | 'savedViews'
  | 'displayControls'
  | 'rowActions'
  | 'bulkActions'
  | 'formBody'
  | 'detailBody'
  | 'relationshipPanels'
  | 'modalShell'
  | 'flyoutShell'

export type OperationalRegistryLifecycleAction = 'archive' | 'recover' | 'delete'

export interface OperationalRegistrySlotConfig {
  columns?: string
  grid?: string
  filters?: string
  savedViews?: string
  displayControls?: string
  rowActions?: string
  bulkActions?: string
  formBody?: string
  detailBody?: string
  relationshipPanels?: string
  modalShell?: string
  flyoutShell?: string
}

export interface OperationalRegistryImportExportConfig {
  importLabel?: string
  exportLabel?: string
  supportsImport?: boolean
  supportsExport?: boolean
}

export interface OperationalRegistryWorkspaceAdapter {
  entityKey: string
  entityLabel: string
  pluralEntityLabel: string
  routePath: string
  searchPlaceholder: string
  slots: OperationalRegistrySlotConfig
  importExport?: OperationalRegistryImportExportConfig
  lifecycleCapabilities: Partial<Record<OperationalRegistryLifecycleAction, WorkspaceCapability | true>>
}

export const defineOperationalRegistryWorkspace = <T extends OperationalRegistryWorkspaceAdapter>(adapter: T) => adapter

export const MONITORING_REGISTRY_WORKSPACE = defineOperationalRegistryWorkspace({
  entityKey: 'monitoring',
  entityLabel: 'Monitor',
  pluralEntityLabel: 'Monitoring',
  routePath: '/monitoring',
  searchPlaceholder: 'Search monitors, owners, platforms, links, and notes...',
  slots: {
    columns: 'MonitoringGrid columns',
    grid: 'OperationalGridSurface',
    filters: 'Monitoring filter bar',
    savedViews: 'OperationalSavedViewsPanel',
    displayControls: 'OperationalDisplayPanel',
    rowActions: 'Monitoring row action menu',
    bulkActions: 'Monitoring bulk action flyout',
    formBody: 'MonitoringForm',
    detailBody: 'Monitoring detail dossier',
    relationshipPanels: 'Linked record side panels',
    modalShell: 'WorkspaceModalShells',
    flyoutShell: 'WorkspaceFlyout',
  },
  importExport: {
    importLabel: 'Import monitors',
    exportLabel: 'Export monitors',
    supportsImport: true,
    supportsExport: true,
  },
  lifecycleCapabilities: {
    archive: 'archiveRestore',
    recover: 'archiveRestore',
    delete: true,
  },
})

// Legacy compatibility alias for the pre-standardized vendor view.
// Keep this until Vendors gets its own workspace contract.
export const VENDOR_WORKSPACE_STANDARD: WorkspaceDefinition = MONITORING_WORKSPACE_STANDARD

export const EXTERNAL_WORKSPACE_STANDARD: WorkspaceDefinition = {
  ...MONITORING_WORKSPACE_STANDARD,
  workspaceName: 'External',
}

export const OPERATIONAL_WORKSPACE_CAPABILITY_MATRIX: Record<string, OperationalWorkspaceAdapter> = {
  monitoring: {
    entityLabel: 'Monitor',
    supports: MONITORING_WORKSPACE_STANDARD.sharedCapabilities,
    hasAdvancedEditor: true,
    hasLinkedKnowledge: true,
    hasVersioning: true,
  },
  external: {
    entityLabel: 'External peer',
    supports: ['savedViews', 'displayControls', 'grouping', 'bulkActions', 'compare'],
    hasAdvancedEditor: false,
    hasLinkedKnowledge: false,
    hasVersioning: false,
  },
  architecture: {
    entityLabel: 'Architecture flow',
    supports: ['savedViews', 'displayControls', 'grouping', 'contextMenu', 'bulkActions', 'hoverPreviews', 'history', 'linkedRecords', 'archiveRestore', 'stickyIdentityHeader', 'frontendValidation', 'searchableSelectors'],
    hasAdvancedEditor: false,
    hasLinkedKnowledge: true,
    hasVersioning: true,
  },
  knowledge: {
    entityLabel: 'Knowledge entry',
    supports: ['savedViews', 'displayControls', 'grouping', 'contextMenu', 'bulkActions', 'hoverPreviews', 'history', 'compare', 'linkedRecords', 'archiveRestore', 'stickyIdentityHeader', 'frontendValidation', 'searchableSelectors'],
    hasAdvancedEditor: true,
    hasLinkedKnowledge: false,
    hasVersioning: true,
  },
  vendors: {
    entityLabel: 'Vendor record',
    supports: ['savedViews', 'displayControls', 'grouping', 'contextMenu', 'bulkActions', 'hoverPreviews', 'history', 'linkedRecords', 'archiveRestore', 'stickyIdentityHeader', 'frontendValidation', 'searchableSelectors'],
    hasAdvancedEditor: false,
    hasLinkedKnowledge: false,
    hasVersioning: false,
  },
  rca: {
    entityLabel: 'RCA record',
    supports: ['savedViews', 'displayControls', 'grouping', 'contextMenu', 'bulkActions', 'hoverPreviews', 'history', 'compare', 'linkedRecords', 'archiveRestore', 'stickyIdentityHeader', 'frontendValidation', 'searchableSelectors'],
    hasAdvancedEditor: true,
    hasLinkedKnowledge: true,
    hasVersioning: true,
  },
  projects: {
    entityLabel: 'Project',
    supports: ['savedViews', 'displayControls', 'grouping', 'contextMenu', 'bulkActions', 'hoverPreviews', 'history', 'linkedRecords', 'archiveRestore', 'stickyIdentityHeader', 'frontendValidation', 'searchableSelectors'],
    hasAdvancedEditor: false,
    hasLinkedKnowledge: false,
    hasVersioning: true,
  },
  services: {
    entityLabel: 'Logical service',
    supports: ['savedViews', 'displayControls', 'grouping', 'contextMenu', 'bulkActions', 'hoverPreviews', 'history', 'compare', 'linkedRecords', 'archiveRestore', 'stickyIdentityHeader', 'frontendValidation', 'searchableSelectors'],
    hasAdvancedEditor: false,
    hasLinkedKnowledge: false,
    hasVersioning: false,
  },
  network: {
    entityLabel: 'Network trace',
    supports: ['savedViews', 'displayControls', 'grouping', 'contextMenu', 'bulkActions', 'hoverPreviews', 'history', 'linkedRecords', 'archiveRestore', 'stickyIdentityHeader', 'frontendValidation', 'searchableSelectors'],
    hasAdvancedEditor: false,
    hasLinkedKnowledge: false,
    hasVersioning: false,
  },
  assets: {
    entityLabel: 'Asset',
    supports: ['savedViews', 'displayControls', 'grouping', 'contextMenu', 'bulkActions', 'hoverPreviews', 'history', 'compare', 'linkedRecords', 'archiveRestore', 'stickyIdentityHeader', 'frontendValidation', 'searchableSelectors'],
    hasAdvancedEditor: true,
    hasLinkedKnowledge: true,
    hasVersioning: true,
  },
  far: {
    entityLabel: 'Failure mode',
    supports: ['savedViews', 'displayControls', 'grouping', 'contextMenu', 'bulkActions', 'hoverPreviews', 'history', 'compare', 'linkedRecords', 'archiveRestore', 'stickyIdentityHeader', 'frontendValidation', 'searchableSelectors'],
    hasAdvancedEditor: true,
    hasLinkedKnowledge: true,
    hasVersioning: true,
  },
  research: {
    entityLabel: 'Research vector',
    supports: ['savedViews', 'displayControls', 'grouping', 'contextMenu', 'bulkActions', 'hoverPreviews', 'history', 'compare', 'linkedRecords', 'archiveRestore', 'stickyIdentityHeader', 'frontendValidation', 'searchableSelectors'],
    hasAdvancedEditor: true,
    hasLinkedKnowledge: true,
    hasVersioning: true,
  },
}
