import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Clock, RefreshCcw, Undo2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'react-hot-toast'

import { apiFetch } from '../api/apiClient'
import { formatAppDate } from '../utils/dateUtils'
import { readFarMutationFailureMessage, withFarExpectedVersion } from './FAR.mutationIntegrity'
import {
  formatFarHistoryValue,
  getFarHistoryRestoreAction,
} from './FAR.versionHistoryContract'

export function FARVersionHistory({ mode, onUpdate }: { mode: any; onUpdate: (type: string) => void }) {
  const queryClient = useQueryClient()
  const isArchived = Boolean(mode.is_deleted)
  const {
    data: history = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['far-history', mode.id],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/far/modes/${mode.id}/history`)
      if (!response.ok) throw new Error(await response.text())
      const payload = await response.json()
      if (!Array.isArray(payload)) throw new Error('Expected FAR history list')
      return payload
    },
  })

  const restoreMutation = useMutation({
    mutationFn: async (version: number) => {
      const response = await apiFetch(`/api/v1/far/modes/${mode.id}/restore/${version}`, {
        method: 'POST',
        body: JSON.stringify(withFarExpectedVersion(mode.version)),
      })
      if (!response.ok) throw new Error(await readFarMutationFailureMessage(response))
      return response.json()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['far', 'modes'] })
      await queryClient.invalidateQueries({ queryKey: ['far-history', mode.id] })
      toast.success('Failure vector content restored')
      onUpdate('refresh')
    },
    meta: { handlesErrorToast: true },
    onError: (error: any) => toast.error(`Version restore failed: ${error?.message || 'Unknown error'}`),
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="flex-1 min-h-0 flex flex-col space-y-5"
    >
      <div className="flex items-start justify-between gap-6">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">Version History</h3>
          <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-600">
            Forensic lineage records causal and intervention changes. Core restore preserves current interventions and the independent Active / Archived lifecycle.
          </p>
        </div>
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-blue-400">
          {history.length} snapshots
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center gap-3 py-16 text-blue-400">
            <RefreshCcw size={18} className="animate-spin" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Loading revision timeline...</span>
          </div>
        )}
        {isError && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-6 text-[10px] font-bold uppercase tracking-widest text-rose-400">
            Version history is unavailable.
          </div>
        )}
        {!isLoading && !isError && history.length === 0 && (
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-10 text-center text-[10px] font-bold uppercase tracking-widest text-slate-600">
            No version snapshots recorded yet.
          </div>
        )}
        {history.map((entry: any) => {
          const isCurrent = Number(entry.version) === Number(mode.version)
          const deltas = Array.isArray(entry.delta) ? entry.delta : []
          const forensicFields = Array.isArray(entry.forensic_changed_fields) ? entry.forensic_changed_fields : []
          const restoreAction = getFarHistoryRestoreAction({
            isArchived,
            isCurrent,
            isPending: restoreMutation.isPending,
            coreRestoreAvailable: Boolean(entry.core_restore_available),
            version: Number(entry.version),
          })
          return (
            <div key={entry.id ?? entry.version} className="rounded-lg border border-white/10 bg-white/[0.025] p-5">
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <Clock size={14} className="text-blue-400" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-white">Version {entry.version}</span>
                    {isCurrent && <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-emerald-400">Current</span>}
                    {forensicFields.length > 0 && <span className="rounded-lg border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-purple-400">Intervention lineage</span>}
                  </div>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-tight text-slate-400">{entry.change_summary || 'Recorded FAR change'}</p>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-600">{entry.created_at ? formatAppDate(entry.created_at) : 'Unknown time'}</p>
                </div>
                <button
                  type="button"
                  disabled={restoreAction.disabled}
                  title={restoreAction.title}
                  onClick={() => !restoreAction.disabled && restoreMutation.mutate(Number(entry.version))}
                  className="flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-slate-300 transition-all hover:border-blue-500/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Undo2 size={12} />
                  {restoreAction.label}
                </button>
              </div>

              {Array.isArray(entry.changed_labels) && entry.changed_labels.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {entry.changed_labels.map((label: string) => (
                    <span key={label} className="rounded-lg border border-white/10 bg-black/30 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
                  ))}
                </div>
              )}

              {deltas.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
                  {deltas.map((delta: any, index: number) => (
                    <div key={`${delta.field || delta.label}-${index}`} className="grid grid-cols-[120px_minmax(0,1fr)_18px_minmax(0,1fr)] items-center gap-2 text-[9px] font-bold">
                      <span className="truncate uppercase tracking-widest text-slate-500">{delta.label || delta.field}</span>
                      <span className="truncate rounded-lg bg-black/30 px-2 py-1 text-slate-500" title={formatFarHistoryValue(delta.before)}>{formatFarHistoryValue(delta.before)}</span>
                      <ArrowRight size={11} className="text-slate-700" />
                      <span className="truncate rounded-lg bg-black/30 px-2 py-1 text-slate-300" title={formatFarHistoryValue(delta.after)}>{formatFarHistoryValue(delta.after)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
