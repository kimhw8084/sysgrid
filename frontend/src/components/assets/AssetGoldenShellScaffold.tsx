import React from 'react'
import { FileText, Globe, LayoutGrid, Server } from 'lucide-react'
import { HeaderScopeSwitch, ToolbarSearch } from '../shared/LayoutPrimitives'
import { OperationalWorkspaceShell } from '../shared/OperationalWorkspaceShells'

type AssetGoldenShellScaffoldProps = {
  activeTab: 'inventory' | 'deleted'
  existingCount: number
  purgedCount: number
  onTabChange: (next: 'inventory' | 'deleted') => void
  searchTerm: string
  onSearchTermChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  toolbarControls: React.ReactNode
  secondaryToolbar?: React.ReactNode
  toolbarActions?: React.ReactNode
  filterChips: Array<{ id: string; label: string; onRemove: () => void }>
  floatingPanels?: React.ReactNode
  children: React.ReactNode
  viewMode: 'grid' | 'report' | 'map'
  onViewModeChange: (mode: 'grid' | 'report' | 'map') => void
}

export default function AssetGoldenShellScaffold({
  activeTab,
  existingCount,
  purgedCount,
  onTabChange,
  searchTerm,
  onSearchTermChange,
  toolbarControls,
  secondaryToolbar,
  toolbarActions,
  filterChips,
  floatingPanels,
  children,
  viewMode,
  onViewModeChange,
}: AssetGoldenShellScaffoldProps) {
  return (
    <OperationalWorkspaceShell
      workspace="assets"
      className="relative overflow-hidden"
      header={{
        eyebrow: 'Infrastructure',
        title: (
          <div className="flex items-center gap-3">
            <Server className="text-blue-500" size={18} />
            <span>Assets</span>
          </div>
        ),
        subtitle: 'Operational asset inventory, topology context, and ownership status',
        actions: (
          <div className="flex items-center gap-4">
            <HeaderScopeSwitch
              label={<span className="hidden lg:inline">View Surface</span>}
              value={viewMode}
              onChange={(next) => onViewModeChange(next as 'grid' | 'report' | 'map')}
              options={[
                { label: <span className="flex items-center gap-2"><LayoutGrid size={13} /> Grid</span>, value: 'grid' },
                { label: <span className="flex items-center gap-2"><FileText size={13} /> Report</span>, value: 'report' },
                { label: <span className="flex items-center gap-2"><Globe size={13} /> Map</span>, value: 'map' },
              ]}
            />
            <div className="h-8 w-px bg-white/5" />
            <HeaderScopeSwitch
              label={<span className="hidden lg:inline">Registry Scope</span>}
              value={activeTab}
              onChange={(next) => onTabChange(next as 'inventory' | 'deleted')}
              options={[
                { label: `Existing (${existingCount})`, value: 'inventory' },
                { label: `Archived (${purgedCount})`, value: 'deleted' },
              ]}
            />
          </div>
        ),
      }}
      toolbarSearch={(
        <ToolbarSearch
          value={searchTerm}
          onChange={onSearchTermChange}
          placeholder="Scan asset matrix..."
        />
      )}
      toolbarControls={toolbarControls}
      secondaryToolbar={secondaryToolbar}
      toolbarActions={toolbarActions}
      filterChips={filterChips}
      floatingPanels={floatingPanels}
    >
      {children}
    </OperationalWorkspaceShell>
  )
}
