import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import {
  WorkspaceFieldError,
  WorkspaceFieldLabel,
  WorkspaceFloatingPanel,
  WorkspaceSelectField,
  useWorkspaceAnchoredLayer,
} from './OperationalWorkspacePrimitives'

export interface OperationalAssetRecord {
  id: number
  name: string
  system?: string | null
  type?: string | null
}

export interface OperationalAssetSelectorProps {
  label: string
  required?: boolean
  assets?: readonly OperationalAssetRecord[]
  value: number | null
  onChange: (value: number | null) => void
  error?: string
  placeholder?: string
  searchPlaceholder?: string
  filterLabel?: string
  allFilterLabel?: string
  selectedAssetLabel?: (asset: OperationalAssetRecord) => string
}

const defaultSelectedAssetLabel = (asset: OperationalAssetRecord) => `${asset.name} [${asset.system}]`

export function OperationalAssetSelector({
  label,
  required = false,
  assets = [],
  value,
  onChange,
  error,
  placeholder = 'Select asset',
  searchPlaceholder = 'Search hostname or system...',
  filterLabel = 'System Filter',
  allFilterLabel = 'All Systems',
  selectedAssetLabel = defaultSelectedAssetLabel,
}: OperationalAssetSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [systemFilter, setSystemFilter] = useState('ALL')
  const { triggerRef, panelRef, panelStyle } = useWorkspaceAnchoredLayer(isOpen, { minWidth: 420 })
  const selectedAsset = assets.find((asset) => asset.id === value)
  const systems = Array.from(new Set(assets.map((asset) => asset.system).filter(Boolean))).sort()
  const filteredAssets = assets.filter((asset) => {
    const matchesSystem = systemFilter === 'ALL' || asset.system === systemFilter
    const needle = `${asset.name} ${asset.system || ''}`.toLowerCase()
    const matchesSearch = !search || needle.includes(search.toLowerCase())
    return matchesSystem && matchesSearch
  })

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setIsOpen(false)
    }
    window.addEventListener('mousedown', handleClick)

    return () => {
      window.removeEventListener('mousedown', handleClick)
    }
  }, [isOpen, panelRef, triggerRef])

  return (
    <div className="space-y-1.5">
      <WorkspaceFieldLabel label={label} required={required} />
      <div>
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          ref={(node) => {
            triggerRef.current = node
          }}
          aria-expanded={isOpen}
          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-all ${error ? 'border-rose-500/60 bg-rose-500/10' : 'border-white/10 bg-slate-950/70 hover:border-blue-500/30'}`}
        >
          <span className={`text-[clamp(10px,0.85vw,12px)] font-black truncate pr-4 ${selectedAsset ? 'text-slate-100' : 'text-slate-500'}`}>
            {selectedAsset ? selectedAssetLabel(selectedAsset) : placeholder}
          </span>
          <ChevronDown size={12} className={`shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && typeof document !== 'undefined' && createPortal(
          <div ref={panelRef} style={panelStyle}>
            <WorkspaceFloatingPanel
              kind="menu"
              className="p-2"
            >
              <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2">
                <WorkspaceSelectField
                  label={filterLabel}
                  value={systemFilter}
                  onChange={(nextValue) => setSystemFilter(String(nextValue))}
                  options={[{ value: 'ALL', label: allFilterLabel }, ...systems.map((system) => ({ value: system, label: system }))]}
                  placeholder={allFilterLabel}
                />
                <div className="space-y-1.5">
                  <WorkspaceFieldLabel label="Search Asset" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-black text-slate-100 outline-none focus:border-blue-500/40"
                  />
                </div>
              </div>
              <div className="mt-2 max-h-52 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                <button
                  type="button"
                  onClick={() => {
                    onChange(null)
                    setIsOpen(false)
                  }}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${value == null ? 'border-blue-500/30 bg-blue-500/10' : 'border-white/5 bg-black/20 hover:border-white/10'}`}
                >
                  <p className="text-[9px] font-black text-slate-200">No linked asset</p>
                </button>
                {filteredAssets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      onChange(asset.id)
                      setIsOpen(false)
                      setSearch('')
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${asset.id === value ? 'border-blue-500/30 bg-blue-500/10' : 'border-white/5 bg-black/20 hover:border-white/10'}`}
                  >
                    <p className={`text-[9px] font-black ${asset.id === value ? 'text-blue-300' : 'text-slate-200'}`}>{asset.name}</p>
                    <p className="mt-0.5 text-[8px] font-black text-slate-500 truncate">{asset.system || 'No system'}</p>
                  </button>
                ))}
              </div>
            </WorkspaceFloatingPanel>
          </div>,
          document.body
        )}
      </div>
      <WorkspaceFieldError message={error} />
    </div>
  )
}
