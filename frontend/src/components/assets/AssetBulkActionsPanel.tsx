import React from 'react'
import { Zap } from 'lucide-react'
import { OperationalAnchoredPanel } from '../shared/OperationalWorkspaceShells'
import { WorkspaceFloatingPanel } from '../shared/OperationalWorkspacePrimitives'
import { WorkspaceFlyoutActionCard, WorkspaceFlyoutDropdownEditor } from '../shared/WorkspaceFlyout'
import { OPERATIONAL_ACTION_LABELS } from '../shared/OperationalActionLabels'

type AssetBulkActionsPanelProps = {
  activeTab: 'inventory' | 'deleted'
  isOpen: boolean
  panelRef: React.RefObject<HTMLDivElement | null>
  panelStyle: React.CSSProperties
  selectedCount: number
  selectedLabels?: string[]
  onClose: () => void
  onApply: (action: string, payload?: Record<string, any>) => void
}

const STATUS_OPTIONS = ['Active', 'Offline', 'Failed', 'Retired']
const ENV_OPTIONS = ['Production', 'Staging', 'Development', 'Lab']

export function AssetBulkActionsPanel({
  activeTab,
  isOpen,
  panelRef,
  panelStyle,
  selectedCount,
  selectedLabels = [],
  onClose,
  onApply,
}: AssetBulkActionsPanelProps) {
  const [selectedStatus, setSelectedStatus] = React.useState('')
  const [selectedEnv, setSelectedEnv] = React.useState('')
  const [expandedSection, setExpandedSection] = React.useState<'status' | 'environment' | 'delete' | 'restore' | 'purge' | null>(null)

  React.useEffect(() => {
    setSelectedStatus('')
    setSelectedEnv('')
    setExpandedSection(null)
  }, [isOpen, selectedCount, activeTab])

  const selectionPreview = selectedLabels.slice(0, 3).join(', ')
  const selectionSuffix = selectedCount > 3 ? ` +${selectedCount - 3} more` : ''

  return (
    <OperationalAnchoredPanel
      isOpen={isOpen}
      panelRef={panelRef}
      style={panelStyle}
      panelKey="asset-bulk-menu"
      className="bulk-menu-container"
      yOffset={10}
    >
      <WorkspaceFloatingPanel kind="context" className="max-h-[560px] overflow-y-auto p-3 custom-scrollbar">
        <div className="space-y-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-blue-400" />
              <p className="text-[10px] font-semibold text-slate-400">Bulk actions</p>
            </div>
            <p className="pt-1 text-[12px] font-semibold text-slate-100">{selectedCount} assets selected</p>
            {selectionPreview ? (
              <p className="pt-1 text-[10px] text-slate-500">{selectionPreview}{selectionSuffix}</p>
            ) : null}
          </div>

          {activeTab === 'inventory' ? (
            <>
              <WorkspaceFlyoutActionCard
                title="Set Status"
                active={expandedSection === 'status'}
                onClick={() => setExpandedSection(expandedSection === 'status' ? null : 'status')}
              />
              {expandedSection === 'status' ? (
                <WorkspaceFlyoutDropdownEditor
                  value={selectedStatus}
                  onChange={setSelectedStatus}
                  options={STATUS_OPTIONS.map((status) => ({ value: status, label: status }))}
                  placeholder="Choose status"
                  actionLabel="Preview Status Change"
                  onApply={() => {
                    onApply('update', { status: selectedStatus })
                    onClose()
                  }}
                  disabled={!selectedStatus}
                />
              ) : null}
              <WorkspaceFlyoutActionCard
                title="Set Environment"
                active={expandedSection === 'environment'}
                onClick={() => setExpandedSection(expandedSection === 'environment' ? null : 'environment')}
              />
              {expandedSection === 'environment' ? (
                <WorkspaceFlyoutDropdownEditor
                  value={selectedEnv}
                  onChange={setSelectedEnv}
                  options={ENV_OPTIONS.map((env) => ({ value: env, label: env }))}
                  placeholder="Choose environment"
                  actionLabel="Preview Environment Change"
                  onApply={() => {
                    onApply('update', { environment: selectedEnv })
                    onClose()
                  }}
                  disabled={!selectedEnv}
                />
              ) : null}
              <WorkspaceFlyoutActionCard
                title={OPERATIONAL_ACTION_LABELS.archiveSelection}
                active={expandedSection === 'delete'}
                onClick={() => {
                  setExpandedSection(expandedSection === 'delete' ? null : 'delete')
                              }}
              />
              {expandedSection === 'delete' ? (
                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-3 space-y-3">
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Archive moves these assets out of the active list while keeping them available to restore.
                  </p>
                  <button
                    type="button"
                    onClick={() => { onApply('delete'); onClose() }}
                    className="w-full rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-center text-[10px] font-black uppercase tracking-wider text-rose-400 transition-all hover:bg-rose-500/20"
                  >
                    Preview Archive
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <WorkspaceFlyoutActionCard
                title={OPERATIONAL_ACTION_LABELS.restore}
                active={expandedSection === 'restore'}
                onClick={() => {
                  setExpandedSection(expandedSection === 'restore' ? null : 'restore')
                              }}
              />
              {expandedSection === 'restore' ? (
                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-3 space-y-3">
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Preview the exact records that can return to the Existing registry scope.
                  </p>
                  <button
                    type="button"
                    onClick={() => { onApply('restore'); onClose() }}
                    className="w-full rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-center text-[10px] font-black uppercase tracking-wider text-emerald-400 transition-all hover:bg-emerald-500/20"
                  >
                    Preview Restore
                  </button>
                </div>
              ) : null}

              <WorkspaceFlyoutActionCard
                title={OPERATIONAL_ACTION_LABELS.purgeSelection}
                active={expandedSection === 'purge'}
                onClick={() => {
                  setExpandedSection(expandedSection === 'purge' ? null : 'purge')
                              }}
              />
              {expandedSection === 'purge' ? (
                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-3 space-y-3">
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Preview permanent removal and its exact record impact. This action cannot be undone.
                  </p>
                  <button
                    type="button"
                    onClick={() => { onApply('purge'); onClose() }}
                    className="w-full rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-center text-[10px] font-black uppercase tracking-wider text-rose-400 transition-all hover:bg-rose-500/20"
                  >
                    Preview Permanent Purge
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </WorkspaceFloatingPanel>
    </OperationalAnchoredPanel>
  )
}
