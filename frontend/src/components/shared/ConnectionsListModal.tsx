import React from 'react'
import { Network, Zap, ArrowRightLeft, ExternalLink } from 'lucide-react'
import { WorkspaceModal } from './WorkspaceModal'

interface ConnectionsListModalProps {
  isOpen: boolean
  onClose: () => void
  connections: any[]
  devices: any[]
  deviceName: string
  onViewForensics: (conn: any) => void
}

export const ConnectionsListModal: React.FC<ConnectionsListModalProps> = ({ isOpen, onClose, connections, devices, deviceName, onViewForensics }) => {
  const sourceDevice = devices.find(d => d.name === deviceName)

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={onClose}
      size="workspace"
      title="Interconnect Registry"
      subtitle={(
        <div className="flex items-center gap-4 mt-1 text-[10px] font-bold text-slate-400">
          <p className="flex items-center gap-1.5 uppercase tracking-widest">
            <span className="px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 font-mono tracking-normal text-slate-300">{deviceName}</span>
          </p>
          <p className="flex items-center gap-1.5 uppercase tracking-widest">
            <Zap size={10} className="text-amber-500" /> {connections.length} Active Physical Paths Detected
          </p>
        </div>
      )}
      icon={<Network size={24} />}
      footerLeft={(
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
            <span className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Fabric Verification Active</span>
          </div>
          <div className="h-3 w-px bg-white/10" />
          <span className="text-[9px] font-mono text-slate-600">ID: {sourceDevice?.id || '---'}</span>
        </div>
      )}
      footerRight={(
        <button 
          onClick={onClose} 
          className="rounded-lg border border-white/10 bg-black/20 px-6 py-2 text-[10px] font-black uppercase tracking-widest text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          Close Registry
        </button>
      )}
    >
      <div className="-mx-6 -mt-6 sm:-mx-8 sm:-mt-8">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="sg-data-table min-w-full text-left border-collapse">
            <thead className="bg-[#020617] sticky top-0 z-10 shadow-sm border-b border-white/5">
              <tr className="bg-white/[0.01] text-[10px] text-slate-500 font-black uppercase tracking-widest">
                <th className="px-8 py-4 font-black">Connected Peer (Target)</th>
                <th className="px-6 py-4 font-black text-center">Farm</th>
                <th className="px-6 py-4 font-black">Egress Port</th>
                <th className="px-6 py-4 font-black text-center">Ingress Port</th>
                <th className="px-6 py-4 font-black text-center">Peer R/S</th>
                <th className="px-6 py-4 font-black text-center">Status</th>
                <th className="px-8 py-4 font-black text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {connections.map((conn) => {
                const isSource = sourceDevice?.id === conn.source_device_id
                const peerId = isSource ? conn.target_device_id : conn.source_device_id
                const peerDevice = devices.find(d => d.id === peerId)

                const peerName = peerDevice?.name || (isSource ? conn.server_b : conn.server_a) || "Unknown Asset"
                const peerSystem = peerDevice?.system || "N/A"

                const localPort = isSource ? conn.source_port : conn.target_port
                const remotePort = isSource ? conn.target_port : conn.source_port
                
                const peerRack = isSource ? conn.peer_rack : conn.src_rack
                const peerSlot = isSource ? conn.peer_slot : conn.src_slot

                return (
                  <tr key={conn.id} className="group hover:bg-blue-500/[0.03] transition-colors">
                    <td className="px-8 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-800 border border-white/5 flex items-center justify-center shrink-0 group-hover:border-blue-500/30 transition-colors">
                          <ArrowRightLeft size={14} className="text-slate-500 group-hover:text-blue-400" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-black text-slate-200 uppercase tracking-tight group-hover:text-white truncate">{peerName}</span>
                          <span className="text-[9px] font-bold text-slate-600 group-hover:text-slate-400 transition-colors uppercase truncate">{peerSystem}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="text-[10px] font-black text-indigo-400 uppercase">{conn.farm || 'N/A'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-mono font-bold text-blue-400">{localPort || 'AUTO-NEG'}</span>
                        <span className="text-[8px] text-slate-600 font-black uppercase tracking-tighter">Local Egress</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] font-mono font-bold text-emerald-400">{remotePort || 'AUTO-NEG'}</span>
                        <span className="text-[8px] text-slate-600 font-black uppercase tracking-tighter">Peer Ingress</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] font-bold text-slate-300 uppercase">{peerRack || 'N/A'}</span>
                        <span className="text-[8px] text-slate-600 font-black uppercase tracking-tighter">Slot {peerSlot || '-'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest border ${
                        conn.status === 'Active' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 
                        conn.status === 'Requested' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' :
                        conn.status === 'Planned' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                        'bg-slate-500/10 border-slate-500/20 text-slate-400'
                      }`}>
                        {conn.status || 'Active'}
                      </span>
                    </td>
                    <td className="px-8 py-4 text-right">
                      <button 
                        onClick={() => onViewForensics(conn)}
                        className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-600/10 text-blue-400 border border-blue-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all active:scale-95 group/btn"
                      >
                        <ExternalLink size={12} className="group-hover/btn:scale-110 transition-transform" />
                        Inspect
                      </button>
                    </td>
                  </tr>
                )
              })}
              {connections.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-32 text-center">
                    <div className="flex flex-col items-center gap-4 opacity-20">
                      <Network size={64} className="text-slate-500" />
                      <div>
                        <p className="text-slate-300 font-black uppercase tracking-[0.4em] text-lg">Empty Fabric</p>
                        <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px] mt-1">No valid physical links mapped to this entity</p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </WorkspaceModal>
  )
}
