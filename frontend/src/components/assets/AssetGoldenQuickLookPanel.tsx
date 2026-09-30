import { motion } from 'framer-motion'
import { Edit2, Search, X } from 'lucide-react'
import { WorkspacePortal, useWorkspaceDialogLayer } from '../shared/WorkspaceOverlay'
import {
  WorkspaceFloatingPanel,
  WorkspacePanelSubtitle,
  WorkspacePanelTitle,
  WorkspaceSectionBadge,
} from '../shared/OperationalWorkspacePrimitives'

export default function AssetGoldenQuickLookPanel({
  asset,
  onClose,
  onEdit,
}: {
  asset: any
  onClose: () => void
  onEdit: (asset: any) => void
}) {
  const dialogLayer = useWorkspaceDialogLayer(true, onClose)

  const statusTone =
    asset.status === 'Active'
      ? 'emerald'
      : asset.status === 'Maintenance' || asset.status === 'Planned'
        ? 'amber'
        : 'rose'

  return (
    <WorkspacePortal><motion.div
      {...dialogLayer}
      role="dialog" aria-modal="true" aria-label={`Asset quick look: ${asset.name}`}
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed inset-y-4 right-4 z-[3600] w-[min(460px,calc(100vw-2rem))]"
    >
      <WorkspaceFloatingPanel kind="detail" className="flex h-full flex-col overflow-hidden border border-white/10">
        <div className="border-b border-white/5 bg-blue-500/5 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex items-start gap-4">
              <div className="rounded-lg border border-blue-500/20 bg-blue-600/15 p-3 text-blue-400">
                <Search size={20} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <WorkspacePanelTitle>{asset.name}</WorkspacePanelTitle>
                  <WorkspaceSectionBadge tone={statusTone as any}>{asset.status || 'Unknown'}</WorkspaceSectionBadge>
                </div>
                <WorkspacePanelSubtitle>{asset.system} // {asset.type}</WorkspacePanelSubtitle>
              </div>
            </div>
            <button aria-label="Close quick look" onClick={onClose} className="rounded-lg border border-white/10 bg-black/20 p-2 text-slate-500 transition-all hover:border-white/20 hover:text-white">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6 custom-scrollbar">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/5 bg-black/20 p-4">
              <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-500">Status</p>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${asset.status === 'Active' ? 'bg-emerald-500' : asset.status === 'Maintenance' || asset.status === 'Planned' ? 'bg-amber-500' : 'bg-rose-500'}`} />
                <span className={`text-xs font-black uppercase ${asset.status === 'Active' ? 'text-emerald-400' : asset.status === 'Maintenance' || asset.status === 'Planned' ? 'text-amber-400' : 'text-rose-400'}`}>{asset.status}</span>
              </div>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/20 p-4">
              <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-500">Environment</p>
              <span className="text-xs font-black uppercase text-blue-400">{asset.environment || 'N/A'}</span>
            </div>
          </div>

          <section className="space-y-3 rounded-lg border border-white/5 bg-black/10 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-500">Network Vector</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4 border-b border-white/[0.04] py-2">
                <span className="text-[10px] font-bold uppercase text-slate-400">Primary IP</span>
                <span className="text-[11px] font-mono font-bold text-white">{asset.primary_ip || 'N/A'}</span>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-white/[0.04] py-2">
                <span className="text-[10px] font-bold uppercase text-slate-400">Mgmt URL</span>
                <span className="max-w-[220px] truncate text-[11px] font-mono font-bold text-blue-400">{asset.management_url || 'N/A'}</span>
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-white/5 bg-black/10 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-500">Hardware Registry</p>
            <p className="text-xs font-bold uppercase italic leading-relaxed text-slate-300">"{asset.hardware_summary || 'No hardware description captured.'}"</p>
          </section>
        </div>

        <div className="border-t border-white/5 bg-black/10 p-6">
          <button
            onClick={() => onEdit(asset)}
            className="flex w-full items-center justify-center gap-3 rounded-lg bg-blue-600 py-4 text-[11px] font-black uppercase tracking-widest text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500"
          >
            <Edit2 size={16} />
            Engage Full Configuration
          </button>
        </div>
      </WorkspaceFloatingPanel>
    </motion.div></WorkspacePortal>
  )
}
