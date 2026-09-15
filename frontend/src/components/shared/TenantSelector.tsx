import React, { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Database, ChevronDown, Check, Plus, Server } from "lucide-react"
import { apiFetch } from "../../api/apiClient"
import toast from "react-hot-toast"
import {
  getWorkspaceFloatingPanelClass,
  useEscapeDismiss,
  useWorkspaceAnchoredLayer,
} from "./OperationalWorkspacePrimitives"

export function TenantSelector() {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { triggerRef, panelRef, panelStyle } = useWorkspaceAnchoredLayer(isOpen, { minWidth: 256 })
  useEscapeDismiss(() => {
    setIsOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, isOpen)
  const getTenantLabel = (tenant: any) => {
    if (tenant?.name?.trim()) return tenant.name
    const dbUrl = tenant?.db_url || ""
    const normalized = dbUrl.replace(/^sqlite\+aiosqlite:\/\//, "")
    const parts = normalized.split("/").filter(Boolean)
    return parts[parts.length - 1] || `Tenant #${tenant?.id ?? "unknown"}`
  }

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['my-tenants'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/tenants/me")
      if (!res.ok) return []
      return res.json()
    }
  })

  const selectMutation = useMutation({
    mutationFn: async (tenantId: number) => {
      const res = await apiFetch("/api/v1/tenants/select", {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId })
      })
      if (!res.ok) throw new Error("Failed to switch database")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Database switched successfully")
      queryClient.invalidateQueries()
      // Reload the page to ensure all components refresh with new data context
      window.location.reload()
    },
    onError: (err: any) => {
      toast.error(err.message)
    }
  })

  const activeTenant = tenants?.find((t: any) => t.is_selected)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target) ||
        (target instanceof HTMLElement && target.closest('[data-workspace-panel]'))
      ) {
        return
      }
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [panelRef, triggerRef])

  return (
    <div className="relative">
      <button 
        ref={(node) => {
          triggerRef.current = node
        }}
        onClick={() => setIsOpen(!isOpen)}
        className="flex min-h-10 items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 hover:bg-[var(--surface-hover)]"
        aria-label="Switch tenant"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--action-primary)] text-white">
           <Database size={14} aria-hidden="true" />
        </div>
        <div className="flex flex-col items-start min-w-[120px]">
           <span className="text-[10px] font-medium text-[var(--text-muted)]">Current tenant</span>
           <span className="max-w-[150px] truncate text-sm font-medium text-[var(--text-primary)]">
             {isLoading ? 'Loading...' : (activeTenant ? getTenantLabel(activeTenant) : 'Default tenant')}
           </span>
        </div>
        <ChevronDown size={14} aria-hidden="true" className={`text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && typeof document !== "undefined" && createPortal(
            <div 
              ref={panelRef}
              style={panelStyle}
              data-workspace-panel="true"
              role="menu"
              aria-label="Available tenants"
              onMouseDown={(e) => e.stopPropagation()}
              className={`${getWorkspaceFloatingPanelClass('menu')} overflow-hidden backdrop-blur-xl`}
            >
              <div className="p-4 border-b border-white/5 bg-white/2">
                 <h4 className="text-sm font-semibold text-[var(--text-primary)]">Switch tenant</h4>
              </div>
              
              <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-2 space-y-1">
                {tenants?.map((tenant: any) => (
                  <button
                    key={tenant.id}
                    type="button"
                    onClick={() => {
                      if (tenant.is_selected) {
                        toast("This database is already active", { icon: "ℹ️" })
                      } else if (!tenant.is_online) {
                        toast.error("This database is offline and cannot be activated")
                      } else {
                        selectMutation.mutate(tenant.id)
                      }
                      setIsOpen(false)
                    }}
                    disabled={!tenant.is_online}
                    role="menuitem"
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${tenant.is_selected ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : tenant.is_online ? 'hover:bg-white/5 text-slate-400 hover:text-white' : 'opacity-40 cursor-not-allowed'}`}
                  >
                    <div className="flex items-center gap-3">
                       <div className="relative">
                          <Server size={14} className={tenant.is_selected ? 'text-white' : 'text-slate-500'} />
                          <div className={`absolute -top-1 -right-1 w-2 h-2 rounded-full border-2 border-[#0f172a] ${tenant.is_online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                       </div>
                       <div className="flex flex-col items-start">
                    <span className="text-[11px] font-black tracking-[0.04em]">{getTenantLabel(tenant)}</span>
                          <div className="flex items-center gap-2">
                             <span className="text-[8px] font-bold uppercase opacity-60">{tenant.role}</span>
                             {!tenant.is_online && <span className="text-[7px] font-black text-rose-500 uppercase">Offline</span>}
                          </div>
                       </div>
                    </div>
                    {tenant.is_selected && <Check size={14} />}
                  </button>
                ))}

                {(!tenants || tenants.length === 0) && !isLoading && (
                   <div className="p-4 text-center">
                      <p className="text-[10px] font-semibold text-[var(--text-muted)]">No other tenants available</p>
                   </div>
                )}
              </div>

              <div className="p-3 bg-black/20 border-t border-white/5">
                 <button 
                    onClick={() => {
                        setIsOpen(false);
                        // Navigate to settings tab for multi-tenancy if admin
                        window.location.href = '/settings?tab=tenants';
                    }}
                    className="w-full flex items-center justify-center gap-2 p-2 rounded-lg border border-white/5 text-[9px] font-black uppercase text-slate-500 hover:text-white hover:bg-white/5 transition-all"
                 >
                    <Plus size={12} /> Manage tenants
                 </button>
              </div>
            </div>,
          document.body
        )}
    </div>
  )
}
