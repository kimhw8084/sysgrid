import React, { useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  Database,
  Download,
  FileText,
  Filter,
  Info,
  Layout,
  Maximize2,
  Plus,
  Search,
  Settings2,
  Shield,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  PageHeader,
  PageToolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarIconButton,
  ToolbarSearch,
  ToolbarSegmented,
} from './shared/LayoutPrimitives'
import {
  OPERATIONAL_WORKSPACE_CAPABILITY_MATRIX,
  OPERATIONAL_WORKSPACE_MINIMUM_STANDARD,
  OPERATIONAL_WORKSPACE_VISUALS,
  MONITORING_WORKSPACE_STANDARD,
} from './shared/OperationalWorkspace'
import {
  WorkspaceCollapsibleHeader,
  WorkspaceEmptyState,
  WorkspacePanelSubtitle,
  WorkspacePanelTitle,
  WorkspaceSectionBadge,
  WorkspaceSectionCard,
  WorkspaceModalSize,
  getWorkspaceModalShellClass,
} from './shared/OperationalWorkspacePrimitives'
import { WorkspaceModal } from './shared/WorkspaceModal'

type SectionProps = {
  id: string
  title: string
  description: string
  children: React.ReactNode
}

function Section({ id, title, description, children }: SectionProps) {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <section id={id} className="space-y-4 border-t border-white/5 pt-8 first:border-t-0 first:pt-0 scroll-mt-24">
      <WorkspaceCollapsibleHeader
        title={<span className="text-xl font-black tracking-tighter text-white">{title}</span>}
        subtitle={<span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{description}</span>}
        collapsed={collapsed}
        onToggle={() => setCollapsed((current) => !current)}
        action={<span data-section-state="true" />}
      />
      {!collapsed && (
        <div className={`p-6 ${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-white/5 bg-white/[0.02]`}>
          {children}
        </div>
      )}
    </section>
  )
}

function Guidance({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 border-l border-white/10 pl-3">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white">{term}</p>
      <p className="text-[11px] font-semibold leading-relaxed text-slate-400">{children}</p>
    </div>
  )
}

const modalSizes: Array<{ id: WorkspaceModalSize; description: string }> = [
  { id: 'compact', description: 'Short confirmations and small forms.' },
  { id: 'standard', description: 'Default entity forms and inspections.' },
  { id: 'wide', description: 'Split views and broader analytical content.' },
  { id: 'workspace', description: 'Large designers, grids, and dossier surfaces.' },
  { id: 'fullscreen', description: 'Edge-to-edge focused work.' },
]

const semanticIcons = [
  ['create', Plus],
  ['edit', Settings2],
  ['delete', Trash2],
  ['filter', Filter],
  ['display', Layout],
  ['import', Upload],
  ['export', Download],
  ['close', X],
  ['warning', AlertTriangle],
  ['status', Check],
] as const

export const SettingsStandards = () => {
  const [searchValue, setSearchValue] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [modalSize, setModalSize] = useState<WorkspaceModalSize | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const openModal = (size: WorkspaceModalSize) => setModalSize(size)
  const closeModal = () => setModalSize(null)
  const capabilityEntries = Object.entries(OPERATIONAL_WORKSPACE_CAPABILITY_MATRIX)

  return (
    <div
      data-testid="settings-standards-reference"
      data-settings-tab-content="standards"
      className="space-y-6 pb-20 pt-2"
    >
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-5">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 shrink-0 text-blue-400" size={18} />
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-300">Operational Standards Reference</p>
            <p className="text-[11px] font-semibold leading-relaxed text-slate-300">
              Showcase / specification surface embedded in Settings. Runtime shared contracts and accepted production workspaces remain authoritative when this reference becomes stale.
            </p>
          </div>
        </div>
      </div>

      <PageHeader
        eyebrow="Embedded example"
        title="Page header grammar"
        subtitle="Use the shared primitive for title, subtitle, metadata, and header actions. This example is not a replacement workspace shell."
        meta={<WorkspaceSectionBadge tone="blue">Reference only</WorkspaceSectionBadge>}
        actions={<ToolbarButton variant="secondary"><FileText size={14} /> Header action</ToolbarButton>}
      />

      <PageToolbar
        left={
          <ToolbarGroup>
            <ToolbarButton variant="primary"><Plus size={14} /> Create</ToolbarButton>
            <ToolbarButton><Filter size={14} /> Filter</ToolbarButton>
            <ToolbarIconButton title="Display controls"><Layout size={14} /></ToolbarIconButton>
          </ToolbarGroup>
        }
        right={<ToolbarSearch value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search the reference..." />}
      />

      <div className="rounded-lg border border-white/5 bg-black/20 p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Command grammar</p>
        <p className="mt-2 text-[11px] font-semibold leading-relaxed text-slate-400">
          Header actions establish page scope. Command-bar actions operate on the current view. Optional secondary toolbars provide local controls; contextual row actions and detail actions belong to their record surface. The grammar is shared, while domain action sets differ.
        </p>
      </div>

      <Section id="table-standard" title="Table Standard" description="Grid contracts apply to table-like regions, not every workspace body">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <WorkspacePanelTitle>Operational grid guidance</WorkspacePanelTitle>
            <WorkspacePanelSubtitle>Monitoring, Network, and Assets demonstrate accepted data-grid patterns.</WorkspacePanelSubtitle>
            <div className="space-y-3">
              <Guidance term="Utility columns">Selection, identity, state, and row-action columns use actual grid sizing helpers and remain fixed while content columns flex.</Guidance>
              <Guidance term="Logical rows">Pinned AG Grid fragments are one logical row for assertions and interaction. Test the row identity, not the first rendered fragment.</Guidance>
              <Guidance term="Capabilities">Saved views, display controls, import/export, bulk actions, deep links, and detail routes are capability-specific.</Guidance>
            </div>
          </div>
          <div className="space-y-4">
            <WorkspacePanelTitle>Grid versus custom body</WorkspacePanelTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <WorkspaceSectionCard>
                <WorkspaceSectionBadge tone="emerald">Grid region</WorkspaceSectionBadge>
                <p className="mt-3 text-[11px] font-semibold text-slate-400">Use the operational grid contract where a table-like region exists.</p>
              </WorkspaceSectionCard>
              <WorkspaceSectionCard>
                <WorkspaceSectionBadge tone="amber">Custom body</WorkspaceSectionBadge>
                <p className="mt-3 text-[11px] font-semibold text-slate-400">FAR and Research use accepted custom-body shell patterns and should not be converted into grid-first workspaces.</p>
              </WorkspaceSectionCard>
            </div>
          </div>
        </div>
      </Section>

      <Section id="settings-standard" title="Settings View Standard" description="Embedded Settings composition and content-bound spacing">
        <div className="grid gap-4 md:grid-cols-2">
          <Guidance term="Content boundary">Settings owns the page header, segmented navigation, and scroll boundary. The Standards tab stays inside that composition.</Guidance>
          <Guidance term="Spacing">Use the actual PageToolbar and shared surface primitives. Do not add a nested OperationalWorkspaceShell for a Settings reference tab.</Guidance>
        </div>
      </Section>

      <Section id="gap-standard" title="Gap Standard" description="Use shared layout rhythm without inventing a universal density promise">
        <div className="grid gap-4 md:grid-cols-3">
          <Guidance term="Toolbar to content">Preserve the content-bound spacing of the parent workspace and shared toolbar.</Guidance>
          <Guidance term="Panel internals">Use shared panel primitives and their existing padding rather than duplicating token tables.</Guidance>
          <Guidance term="Responsive flow">Allow controls to wrap through PageToolbar; do not rely on fixed waits or fixed viewport assumptions.</Guidance>
        </div>
      </Section>

      <Section id="operational-lexicon" title="Operational Lexicon" description="Terms separated by scope and authority">
        <div className="grid gap-6 md:grid-cols-2">
          <Guidance term="Universal contract">Shared page headers, toolbar controls, operational surfaces, accessible modal semantics, and supported lifecycle states.</Guidance>
          <Guidance term="Grid-specific">Rows, pinned fragments, utility columns, display controls, saved views, selection, and row menus apply only to table-like regions.</Guidance>
          <Guidance term="Custom-body">FAR and Research retain domain-specific bodies inside accepted shell contracts; they are not synonyms for a Monitoring-style grid.</Guidance>
          <Guidance term="Capability-specific">Import/export, bulk actions, history, compare, linked records, archive/restore, and deep-linked details require an accepted workspace adapter.</Guidance>
          <Guidance term="Sample copy">Text shown here is reference example copy, not a universal product title, domain rule, or source of runtime behavior.</Guidance>
        </div>
      </Section>

      <Section id="layout-directives" title="Layout & Composition Directives" description="Shared composition without a second production shell">
        <div className="grid gap-4 md:grid-cols-2">
          <Guidance term="Full operational workspace">Production workspace shells compose shared header, command, content, panel, and modal contracts around a domain body.</Guidance>
          <Guidance term="Embedded reference surface">SettingsStandards demonstrates primitives inside Settings and does not own routing, shell navigation, or workspace identity.</Guidance>
          <Guidance term="Panels and menus">Row menus, floating panels, and side panels are distinct from modal dialogs; use the corresponding shared primitive.</Guidance>
          <Guidance term="Feedback">Loading, empty, error, saving, deletion-pending, and success guidance is valid only where the accepted shared primitive supports it.</Guidance>
        </div>
      </Section>

      <Section id="notification-standards" title="Notification Standards" description="Semantic feedback, not invented toast behavior">
        <div className="grid gap-4 md:grid-cols-2">
          <Guidance term="Success and warning">Use accepted semantic tones for state feedback and preserve the operator’s natural text.</Guidance>
          <Guidance term="Destructive confirmation">Use the accepted in-situ or modal confirmation behavior for the owning workspace; this page does not prescribe business semantics.</Guidance>
        </div>
      </Section>

      <Section id="visual-tokens" title="Visual Design Tokens" description="Rendered from OPERATIONAL_WORKSPACE_VISUALS">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(OPERATIONAL_WORKSPACE_VISUALS).map(([name, value]) => (
            <div key={name} className="rounded-lg border border-white/5 bg-black/30 p-4">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-blue-400">{name}</p>
              <code className="mt-2 block break-words text-[10px] font-mono text-slate-400">{value}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section id="radius-standards" title="Radius Standards" description="One active standard from the shared visual export">
        <div className="flex flex-wrap items-center gap-4">
          <div className={`h-20 w-20 ${OPERATIONAL_WORKSPACE_VISUALS.standardRadius} border border-blue-500/30 bg-blue-500/10`} />
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white">Default operational surface</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-400">{OPERATIONAL_WORKSPACE_VISUALS.standardRadius} from the shared runtime export. Explicit component exceptions must map to an accepted component.</p>
          </div>
        </div>
      </Section>

      <Section id="icon-registry" title="Iconography Registry" description="Evidence-based semantic guidance">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {semanticIcons.map(([name, Icon]) => (
            <div key={name} className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/30 p-3">
              <Icon size={15} className="text-slate-400" />
              <span className="text-[10px] font-semibold capitalize text-slate-300">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="capability-matrix" title="Capability Matrix" description="Rendered from the shared runtime adapter export">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {capabilityEntries.map(([key, adapter]) => (
            <WorkspaceSectionCard key={key}>
              <div className="flex items-center justify-between gap-3">
                <WorkspacePanelTitle>{adapter.entityLabel}</WorkspacePanelTitle>
                <WorkspaceSectionBadge tone="blue">{key}</WorkspaceSectionBadge>
              </div>
              <p className="mt-3 text-[10px] font-semibold leading-relaxed text-slate-400">{adapter.supports.length ? adapter.supports.join(', ') : 'No shared capability declaration.'}</p>
              <p className="mt-3 text-[10px] font-semibold text-slate-500">{adapter.hasVersioning ? 'Versioning declared.' : 'Versioning not declared.'} {adapter.hasAdvancedEditor ? 'Advanced editor declared.' : ''} {adapter.hasLinkedKnowledge ? 'Linked knowledge declared.' : ''}</p>
            </WorkspaceSectionCard>
          ))}
        </div>
      </Section>

      <Section id="typography" title="Typography & Headers" description="Use actual shared title, subtitle, metadata, and action primitives">
        <PageHeader
          eyebrow="Example eyebrow"
          title="Shared title hierarchy"
          subtitle="Subtitle text is rendered by PageHeader and stays readable without bespoke oversized styling."
          meta={<WorkspaceSectionBadge tone="emerald">Metadata</WorkspaceSectionBadge>}
          actions={<ToolbarButton><Settings2 size={14} /> Action</ToolbarButton>}
        />
      </Section>

      <Section id="interactive" title="Interactive Components" description="Command controls with accessible names and shared sizing">
        <div className="flex flex-wrap items-center gap-3">
          <ToolbarButton variant="primary"><Plus size={14} /> Create</ToolbarButton>
          <ToolbarButton><Search size={14} /> Search</ToolbarButton>
          <ToolbarButton variant="danger"><Trash2 size={14} /> Delete</ToolbarButton>
          <ToolbarIconButton title="Configuration"><Settings2 size={15} /></ToolbarIconButton>
          <ToolbarSegmented options={[{ label: 'Overview', value: 'overview' }, { label: 'History', value: 'history' }]} value={activeTab} onChange={setActiveTab} />
        </div>
      </Section>

      <Section id="modals" title="Modal Schemas" description="Size labels and shell classes derive from WorkspaceModalSize and its runtime helper">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {modalSizes.map(({ id, description }) => (
            <button
              key={id}
              type="button"
              data-modal-size={id}
              onClick={() => openModal(id)}
              className="rounded-lg border border-white/5 bg-black/30 p-4 text-left transition-colors hover:border-blue-500/30"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-white">{id}</span>
                {id === 'fullscreen' ? <Maximize2 size={14} className="text-blue-400" /> : <Layout size={14} className="text-blue-400" />}
              </div>
              <p className="mt-2 text-[10px] font-semibold text-slate-400">{description}</p>
              <code className="mt-3 block break-words text-[9px] font-mono text-slate-600">{getWorkspaceModalShellClass(id)}</code>
            </button>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-[11px] font-semibold leading-relaxed text-slate-300">
          WorkspaceModal supplies accessible dialog semantics, Escape and overlay handling, one header close control when the footer close is hidden, and the dirty-state guard. Side panels and row menus are separate surfaces.
        </div>
      </Section>

      <Section id="empty-states" title="Empty States" description="Shared lifecycle surface with reference copy only">
        <WorkspaceEmptyState
          icon={<Database size={28} />}
          title="No reference records"
          description="This example uses WorkspaceEmptyState. Production workspaces provide their own domain-specific empty-state copy and action."
          action={<ToolbarButton variant="secondary">Review contract</ToolbarButton>}
        />
      </Section>

      <Section id="operational-contract" title="Operational Workspace Contract" description="Minimum shared baseline plus workspace-specific adapters">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <WorkspacePanelTitle>Shared minimum</WorkspacePanelTitle>
            {OPERATIONAL_WORKSPACE_MINIMUM_STANDARD.map((item) => (
              <div key={item} className="flex items-start gap-2 text-[11px] font-semibold leading-relaxed text-slate-400">
                <Check size={14} className="mt-0.5 shrink-0 text-blue-400" />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <WorkspacePanelTitle>Golden production reference</WorkspacePanelTitle>
            <WorkspacePanelSubtitle>{MONITORING_WORKSPACE_STANDARD.workspaceName} is the production golden for applicable shared details; its domain-specific behavior does not become universal.</WorkspacePanelSubtitle>
            {MONITORING_WORKSPACE_STANDARD.monitoringSpecificFeatures.map((item) => (
              <div key={item} className="flex items-start gap-2 text-[11px] font-semibold leading-relaxed text-slate-400">
                <Activity size={14} className="mt-0.5 shrink-0 text-amber-400" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {modalSize && (
        <WorkspaceModal
          isOpen
          onClose={closeModal}
          size={modalSize}
          title={`${modalSize} modal example`}
          subtitle="Runtime WorkspaceModal contract"
          icon={<Info size={20} />}
          hideFooterClose
          isDirty={isDirty}
          dirtyConfirmTitle="Discard reference changes?"
          dirtyConfirmMessage="The example is dirty. Confirming discard uses the shared dirty-state guard."
          footerRight={<ToolbarButton variant="primary" onClick={closeModal}>Save example</ToolbarButton>}
        >
          <div className="space-y-6 py-4">
            <WorkspaceSectionCard>
              <WorkspacePanelTitle>{modalSize} shell</WorkspacePanelTitle>
              <WorkspacePanelSubtitle>This browser-usable example derives its shell class from the shared modal helper.</WorkspacePanelSubtitle>
              <div className="mt-4 flex items-center gap-3">
                <input id="standards-dirty" type="checkbox" checked={isDirty} onChange={(event) => setIsDirty(event.target.checked)} />
                <label htmlFor="standards-dirty" className="text-[11px] font-semibold text-slate-300">Simulate unsaved changes</label>
              </div>
            </WorkspaceSectionCard>
            <div className="grid gap-4 md:grid-cols-2">
              <WorkspaceSectionCard><span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Accessible dialog</span><p className="mt-2 text-[11px] font-semibold text-slate-400">Escape and the overlay request discard through the shared guard.</p></WorkspaceSectionCard>
              <WorkspaceSectionCard><span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Canonical close</span><p className="mt-2 text-[11px] font-semibold text-slate-400">The header close control is the only default close affordance in this example.</p></WorkspaceSectionCard>
            </div>
          </div>
        </WorkspaceModal>
      )}
    </div>
  )
}
