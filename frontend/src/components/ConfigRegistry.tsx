import React, { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, X, Check, Edit2, Layout, Settings, ChevronDown, ChevronRight, PlusCircle, ExternalLink } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { apiFetch } from "../api/apiClient"
import { showWorkspaceToast } from "./shared/WorkspaceToast"
import { WorkspaceModal } from "./shared/WorkspaceModal"
import { ToolbarButton } from "./shared/LayoutPrimitives"
import { useBodyModalFlag } from "./shared/OperationalWorkspacePrimitives"
import { ModulePolicyLink } from "../policy/ModulePolicy"

type RegistrySectionProps = {
  title: string
  category: string
  options: any[]
  icon: any
  usageTargets?: ReadonlyArray<{ label: string; path: string }>
  description?: string
  wrapHeaderOnMobile?: boolean
}

export const ConfigSection = ({ title, category, options, icon: Icon, usageTargets = [], description, wrapHeaderOnMobile = false, onDirtyChange }: RegistrySectionProps & { onDirtyChange?: (dirty: boolean) => void }) => {
  const queryClient = useQueryClient()
  const isTeamCategory = category === "MonitoringTeam"
  const records = Array.isArray(options) ? options : []
  const [isExpanded, setIsExpanded] = useState(false)
  const [newValue, setNewValue] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editMetadata, setEditMetadata] = useState("")

  const isDirty = newValue.trim() !== "" || newDescription.trim() !== "" || editingId !== null
  React.useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const hasMetadataSupport = useMemo(() => {
    if (isTeamCategory) return true
    if (category === "ServiceType" || category === "HardwareProfile" || category === "ExternalType") return true
    return records.some((record: any) => Array.isArray(record.metadata_keys) && record.metadata_keys.length > 0)
  }, [category, isTeamCategory, records])

  const invalidateRegistry = () => {
    queryClient.invalidateQueries({ queryKey: [isTeamCategory ? "teams" : "settings-options"] })
    queryClient.invalidateQueries({ queryKey: ["settings"] })
  }

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(
        isTeamCategory ? "/api/v1/settings/teams" : "/api/v1/settings/options",
        {
          method: "POST",
          body: JSON.stringify(
            isTeamCategory
              ? {
                  name: newValue,
                  description: newDescription,
                }
              : {
                  category,
                  label: newValue,
                  value: newValue,
                  metadata_keys: [],
                }
          ),
        }
      )
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `Failed to add ${isTeamCategory ? "team" : "option"}`)
      }
      return res.json()
    },
    onSuccess: () => {
      invalidateRegistry()
      setNewValue("")
      setNewDescription("")
      showWorkspaceToast(`Added ${newValue}`, { type: 'success' })
    },
    onError: (error: any) => showWorkspaceToast(error.message, { type: 'error' }),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, value, metadataKeys }: { id: number; value: string; metadataKeys: string[] }) => {
      const res = await apiFetch(
        isTeamCategory ? `/api/v1/settings/teams/${id}` : `/api/v1/settings/options/${id}`,
        {
          method: isTeamCategory ? "PATCH" : "PUT",
          body: JSON.stringify(
            isTeamCategory
              ? {
                  name: value,
                  description: editDescription,
                }
              : {
                  label: value,
                  value,
                  metadata_keys: metadataKeys,
                }
          ),
        }
      )
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `Failed to update ${isTeamCategory ? "team" : "option"}`)
      }
      return res.json()
    },
    onSuccess: () => {
      invalidateRegistry()
      setEditingId(null)
      setEditDescription("")
      showWorkspaceToast(isTeamCategory ? "Team updated" : "Option updated", { type: 'success' })
    },
    onError: (error: any) => showWorkspaceToast(error.message, { type: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(
        isTeamCategory ? `/api/v1/settings/teams/${id}` : `/api/v1/settings/options/${id}`,
        { method: "DELETE" }
      )
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `Failed to delete ${isTeamCategory ? "team" : "option"}`)
      }
      return res.json()
    },
    onSuccess: () => {
      invalidateRegistry()
      // showWorkspaceToast(isTeamCategory ? "Team removed" : "Option removed", { type: 'success' })
    },
    onError: (error: any) => showWorkspaceToast(error.message, { type: 'error' }),
  })

  return (
    <div className="overflow-hidden rounded-lg border border-white/5 bg-white/5 transition-all">
      <div className={`group flex cursor-pointer items-center justify-between py-4 transition-all hover:bg-white/5 ${wrapHeaderOnMobile ? 'flex-wrap gap-3 px-4 sm:flex-nowrap sm:px-6' : 'px-6'}`} onClick={() => setIsExpanded(!isExpanded)}>
        <div className={wrapHeaderOnMobile ? 'flex min-w-0 flex-1 items-center space-x-4' : 'flex items-center space-x-4'}>
          <div className={`rounded-lg bg-white/5 p-2 ${isExpanded ? "text-blue-400" : "text-slate-500"}`}>
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </div>
          <div className="space-y-2">
            <div className="flex items-center space-x-3">
              <Icon size={18} className={isExpanded ? "text-blue-400" : "text-slate-500"} />
              <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ${isExpanded ? "text-white" : "text-slate-400"}`}>{title}</h3>
            </div>
            {(description || usageTargets.length > 0) && (
              <div className="flex flex-wrap items-center gap-2 pl-11">
                {description && <span className="text-[9px] font-semibold text-slate-500">{description}</span>}
                {usageTargets.map((target) => (
                  <ModulePolicyLink
                    key={`${category}-${target.path}`}
                    to={target.path}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-blue-300 transition-all hover:bg-blue-500/20"
                    title={`Open ${target.label}`}
                  >
                    <ExternalLink size={10} />
                    <span>{target.label}</span>
                  </ModulePolicyLink>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className={wrapHeaderOnMobile ? 'flex shrink-0 items-center gap-3 sm:gap-6' : 'flex items-center space-x-6'}>
          <div className="flex items-center space-x-2 rounded-lg border border-white/10 bg-black/40 px-3 py-1">
            <span className="text-[10px] font-bold text-blue-400">{records.length}</span>
            <span className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Entries</span>
          </div>
          <button
            onClick={(event) => {
              event.stopPropagation()
              setIsExpanded(true)
            }}
            aria-label={wrapHeaderOnMobile ? `Add ${isTeamCategory ? 'team' : 'option'} to ${title}` : undefined}
            title={wrapHeaderOnMobile ? `Add ${isTeamCategory ? 'team' : 'option'} to ${title}` : undefined}
            className="rounded-lg p-2 text-blue-400 transition-all hover:bg-blue-600 hover:text-white active:scale-90"
          >
            <PlusCircle size={20} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-white/5 bg-black/40"
          >
            <div className="space-y-6 p-6">
              <div className="grid min-h-[50px] grid-cols-1 gap-3 overflow-y-auto pr-2 md:grid-cols-2 lg:grid-cols-3 max-h-[400px] custom-scrollbar">
                {records.map((record: any, index: number) => {
                  const displayLabel = isTeamCategory ? record.name : record.label
                  const detailText = isTeamCategory ? record.description : null
                  const metadataKeys = Array.isArray(record.metadata_keys) ? record.metadata_keys : []
                  const teamOperators = Array.isArray(record.operators) ? record.operators : []
                  return (
                    <div key={record.id} className="group relative flex flex-col rounded-lg border border-white/5 bg-white/5 p-3 transition-all hover:bg-white/10">
                      <div className="flex items-center justify-between">
                        {editingId === record.id ? (
                          <div className="flex flex-1 items-center space-x-2">
                            <input
                              autoFocus
                              value={editValue}
                              onChange={(event) => setEditValue(event.target.value)}
                              className="flex-1 rounded-lg border border-blue-500/50 bg-black/40 px-2 py-1 text-[10px] font-bold text-white outline-none"
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  updateMutation.mutate({
                                    id: record.id,
                                    value: editValue,
                                    metadataKeys: editMetadata.split(",").map((value) => value.trim()).filter(Boolean),
                                  })
                                }
                              }}
                            />
                            <button
                              onClick={() =>
                                updateMutation.mutate({
                                  id: record.id,
                                  value: editValue,
                                  metadataKeys: editMetadata.split(",").map((value) => value.trim()).filter(Boolean),
                                })
                              }
                              className="text-emerald-400 hover:text-emerald-300"
                            >
                              <Check size={16} />
                            </button>
                            <button onClick={() => setEditingId(null)} className="text-slate-500 hover:text-white">
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex min-w-0 items-start space-x-3 overflow-hidden">
                              <span className="pt-0.5 text-[9px] font-bold text-slate-600">{index + 1}</span>
                              <div className="min-w-0 space-y-1">
                                <span className="block truncate text-[11px] font-bold tracking-tight text-slate-200">{displayLabel}</span>
                                {detailText ? <span className="block truncate text-[9px] text-slate-500">{detailText}</span> : null}
                              </div>
                            </div>
                            <div className="flex items-center space-x-1 opacity-0 transition-all group-hover:opacity-100">
                              <button
                                onClick={() => {
                                  setEditingId(record.id)
                                  setEditValue(displayLabel || "")
                                  setEditDescription(isTeamCategory ? record.description || "" : "")
                                  setEditMetadata(metadataKeys.join(", "))
                                }}
                                className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-blue-500/20 hover:text-blue-400"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={() => deleteMutation.mutate(record.id)}
                                className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-rose-500/20 hover:text-rose-400"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </>
                        )}
                      </div>

                      {(hasMetadataSupport || isTeamCategory) && (
                        <div className="mt-2 border-l border-white/5 pl-6">
                          {editingId === record.id ? (
                            <div className="space-y-1">
                              <label className="text-[7px] font-bold uppercase tracking-widest text-slate-500">
                                {isTeamCategory ? "Description" : "Metadata Keys (CSV)"}
                              </label>
                              {isTeamCategory ? (
                                <textarea
                                  value={editDescription}
                                  onChange={(event) => setEditDescription(event.target.value)}
                                  placeholder="Describe monitoring ownership scope..."
                                  className="min-h-[78px] w-full resize-y rounded-lg border border-white/5 bg-black/40 px-2 py-2 text-[9px] text-white outline-none focus:border-blue-500/30"
                                />
                              ) : (
                                <input
                                  value={editMetadata}
                                  onChange={(event) => setEditMetadata(event.target.value)}
                                  placeholder="port, dbname..."
                                  className="w-full rounded-lg border border-white/5 bg-black/40 px-2 py-1 text-[9px] text-white outline-none focus:border-blue-500/30"
                                />
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {isTeamCategory
                                ? teamOperators.map((operator: any) => (
                                    <span key={operator.id} className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[7px] font-semibold tracking-tight text-blue-300">
                                      {operator.full_name || operator.username || operator.external_id}
                                    </span>
                                  ))
                                : metadataKeys.map((key: string) => (
                                    <span key={key} className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[7px] font-semibold tracking-tight text-blue-400">
                                      {key}
                                    </span>
                                  ))}
                              {isTeamCategory && teamOperators.length === 0 ? (
                                <span className="text-[7px] font-bold tracking-widest text-slate-600">No assigned operators</span>
                              ) : null}
                              {!isTeamCategory && metadataKeys.length === 0 ? (
                                <span className="text-[7px] font-bold tracking-widest text-slate-600">No keys</span>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {records.length === 0 && (
                  <div className="col-span-full flex flex-col items-center justify-center space-y-4 py-12 text-center opacity-80">
                    <Settings size={32} className="mb-2 text-slate-600" />
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">No entries configured for this domain</p>
                      <p className="mx-auto max-w-xs text-[9px] font-medium uppercase tracking-widest leading-relaxed text-slate-600">
                        {isTeamCategory
                          ? "Create teams here to govern monitoring ownership and permission grouping across the app."
                          : "Define entries here to populate the shared enum registry consumed by the dependent views."}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mx-auto max-w-md space-y-2">
                <div className="relative">
                  <input
                    value={newValue}
                    onChange={(event) => setNewValue(event.target.value)}
                    placeholder={isTeamCategory ? `Define new ${title}...` : `Define new ${title} entry...`}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 pr-12 text-[11px] font-bold text-white shadow-inner outline-none transition-all focus:border-blue-500"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && newValue) addMutation.mutate()
                    }}
                  />
                  <button
                    onClick={() => newValue && addMutation.mutate()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-blue-600 p-2 text-white shadow-lg transition-all hover:bg-blue-500 active:scale-90"
                  >
                    <Plus size={18} />
                  </button>
                </div>

                {isTeamCategory ? (
                  <div className="space-y-2">
                    <label className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Ownership Description</label>
                    <textarea
                      value={newDescription}
                      onChange={(event) => setNewDescription(event.target.value)}
                      placeholder="Describe what this team owns in monitoring and operations..."
                      className="min-h-[84px] w-full resize-y rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-medium text-white shadow-inner outline-none transition-all focus:border-blue-500"
                    />
                    <p className="text-[8px] font-semibold tracking-tight text-slate-500">
                      Operator membership is managed from the Permissions and Groups views. This registry defines the canonical team list used by Monitoring.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export const ConfigRegistryModal = ({ isOpen, onClose, sections, title, onDirtyChange }: any) => {
  useBodyModalFlag()
  const [isMaximized, setIsMaximized] = useState(false)
  const [dirtyStates, setDirtyStates] = useState<Record<string, boolean>>({})
  const isDirty = useMemo(() => Object.values(dirtyStates).some(Boolean), [dirtyStates])

  React.useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const { data: options } = useQuery({
    queryKey: ["settings-options"],
    queryFn: async () => (await (await apiFetch("/api/v1/settings/options")).json()),
  })
  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => (await (await apiFetch("/api/v1/settings/teams")).json()),
    enabled: sections.some((section: any) => section.category === "MonitoringTeam"),
  })

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={onClose}
      isDirty={isDirty}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title={title || "Registry Configuration"}
      subtitle="Global System Parameters & Enumerations"
      icon={<Layout size={20} />}
    >
      <div className="flex items-center gap-4 px-6 pt-6">
        <div className="h-px flex-1 bg-white/5" />
        <p className="text-[8px] font-bold uppercase tracking-[0.3em] text-slate-600">Forensic Registry Lineage</p>
        <div className="h-px flex-1 bg-white/5" />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-6 custom-scrollbar">
        {sections.map((section: any) => (
          <ConfigSection
            key={section.category}
            title={section.title}
            category={section.category}
            icon={section.icon}
            onDirtyChange={(dirty) => setDirtyStates(prev => ({ ...prev, [section.category]: dirty }))}
            options={
              section.category === "MonitoringTeam"
                ? (Array.isArray(teams) ? teams : [])
                : (Array.isArray(options) ? options.filter((option: any) => option.category === section.category) : [])
            }
          />
        ))}
      </div>
      <div className="mt-8 border-t border-white/5 pt-6 text-center">
        <p className="text-[9px] font-bold uppercase tracking-[0.4em] text-slate-600">SysGrid Core Configuration Node // v3.0.0</p>
      </div>
    </WorkspaceModal>
  )
}
