import React, { useState } from "react"
import { createPortal } from "react-dom"
import { useWorkspacePopupDismiss } from "./WorkspaceOverlay"
import { useQuery, useMutation, useIsMutating, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from 'react-router-dom'
import { Database, ChevronDown, Check, Plus, Server } from "lucide-react"
import { apiFetch } from "../../api/apiClient"
import toast from "react-hot-toast"
import { beginTenantSwitch, getCurrentTenantId, selectCurrentTenant } from '../../api/tenantContext'
import { approveWorkspaceDeparture, hasUnsavedWorkspaceChanges } from './workspaceDeparture'
import { useWorkspaceConfirmation } from './useWorkspaceConfirmation'
import { WorkspaceModal } from './WorkspaceModal'
import {
  getWorkspaceFloatingPanelClass,
  useWorkspaceAnchoredLayer,
} from "./OperationalWorkspacePrimitives"

export function TenantSelector({ compact = false }: { compact?: boolean }) {
  const [isOpen, setIsOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const pendingMutations = useIsMutating()
  const { confirm, confirmation } = useWorkspaceConfirmation()
  const [confirming, setConfirming] = useState(false)
  const { triggerRef, panelRef, panelStyle } = useWorkspaceAnchoredLayer(isOpen, { minWidth: 256 })
  const getTenantLabel = (tenant: any) => {
    if (tenant?.name?.trim()) return tenant.name
    const dbUrl = tenant?.db_url || ""
    const normalized = dbUrl.replace(/^sqlite\+aiosqlite:\/\//, "")
    const parts = normalized.split("/").filter(Boolean)
    return parts[parts.length - 1] || `Tenant #${tenant?.id ?? "unknown"}`
  }

  const { data: tenants, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['my-tenants'],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/tenants/me")
      if (!res.ok) throw new Error('Failed to load available tenants')
      return res.json()
    }
  })

  const selectMutation = useMutation({
    mutationFn: async (tenantId: number) => {
      const finishSwitch = beginTenantSwitch()
      try {
        const res = await apiFetch("/api/v1/tenants/select", {
          method: "POST",
          body: JSON.stringify({ tenant_id: tenantId })
        })
        const result = await res.json()
        if (!res.ok || result.tenant_id !== tenantId) throw new Error("Could not confirm the tenant switch")
        await queryClient.cancelQueries()
        selectCurrentTenant(tenantId)
        return result
      } finally {
        finishSwitch()
      }
    },
    onSuccess: () => {
      // Consent happens before the server request, never in a later unload dialog.
      approveWorkspaceDeparture()
      window.location.reload()
    }
  })

  const isSelected = (tenant: any) => String(tenant.id) === getCurrentTenantId()
  const activeTenant = tenants?.find(isSelected)
  const requestSwitch = async (tenant: any) => {
    if (confirming || selectMutation.isPending) return
    if (isSelected(tenant)) { setIsOpen(false); return }
    if (queryClient.isMutating()) {
      toast('Wait for the current save to finish before switching tenants.')
      return
    }
    setConfirming(true)
    setIsOpen(false)
    try {
      const accepted = await confirm({
        title: 'Switch tenant?',
        message: hasUnsavedWorkspaceChanges()
          ? `Switch to ${getTenantLabel(tenant)} and discard unsaved changes in this tab? Other tabs keep their current tenant.`
          : `Switch this tab to ${getTenantLabel(tenant)}? Other tabs keep their current tenant.`,
        confirmText: 'Switch tenant', cancelText: 'Stay here', variant: 'warning',
      })
      if (!accepted) return
      if (queryClient.isMutating()) {
        toast('Wait for the current save to finish before switching tenants.')
        return
      }
      selectMutation.mutate(tenant.id)
    } finally {
      setConfirming(false)
    }
  }
  const tenantLabel = selectMutation.isPending ? 'Switching tenant...' : isLoading ? 'Loading...' : isError ? 'Tenant unavailable' : activeTenant ? getTenantLabel(activeTenant) : 'No tenant selected'

  useWorkspacePopupDismiss(isOpen, triggerRef, panelRef, () => setIsOpen(false))

  return (
    <div className={`relative ${compact ? 'min-w-0 flex-1' : ''}`}>
      <button 
        ref={(node) => {
          triggerRef.current = node
        }}
        onClick={() => setIsOpen(!isOpen)}
        disabled={selectMutation.isPending || confirming || pendingMutations > 0}
        aria-busy={selectMutation.isPending || isLoading}
        className={`flex min-h-10 items-center gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 hover:bg-[var(--surface-hover)] ${compact ? 'w-full min-w-0' : ''}`}
        aria-label="Switch tenant"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <div className={`${compact ? 'hidden sm:flex' : 'flex'} h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--action-primary)] text-white`}>
           <Database size={14} aria-hidden="true" />
        </div>
        <div className={`flex flex-col items-start ${compact ? 'min-w-0 flex-1' : 'min-w-[120px]'}`}>
           <span className="text-[10px] font-medium text-[var(--text-muted)]">Current tenant</span>
           <span className={`${compact ? 'max-w-full' : 'max-w-[150px]'} truncate text-sm font-medium text-[var(--text-primary)]`} title={tenantLabel}>
             {tenantLabel}
           </span>
        </div>
        <ChevronDown size={14} aria-hidden="true" className={`shrink-0 text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
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
              <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
                 <h4 className="text-sm font-semibold text-[var(--text-primary)]">Switch tenant</h4>
              </div>
              
              <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-2 space-y-1">
                {!isError && tenants?.map((tenant: any) => (
                  <button
                    key={tenant.id}
                    type="button"
                    onClick={() => void requestSwitch(tenant)}
                    disabled={!tenant.is_online || selectMutation.isPending}
                    role="menuitem"
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors ${isSelected(tenant) ? 'bg-[var(--action-primary)] text-white' : tenant.is_online ? 'hover:bg-[var(--surface-hover)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] opacity-50 cursor-not-allowed'}`}
                  >
                    <div className="flex items-center gap-3">
                       <div className="relative">
                          <Server size={14} />
                          <div className={`absolute -top-1 -right-1 w-2 h-2 rounded-full border-2 border-[var(--surface-elevated)] ${tenant.is_online ? 'bg-[var(--state-success)]' : 'bg-[var(--state-danger)]'}`} />
                       </div>
                       <div className="flex flex-col items-start">
                    <span className="text-sm font-medium">{getTenantLabel(tenant)}</span>
                          <div className="flex items-center gap-2">
                             <span className="text-xs">{tenant.role}</span>
                             {!tenant.is_online && <span className="text-xs text-[var(--state-danger)]">Offline</span>}
                          </div>
                       </div>
                    </div>
                    {isSelected(tenant) && <Check size={14} />}
                  </button>
                ))}

                {isError && (
                  <div className="p-4 text-center space-y-3" role="status">
                    <p className="text-xs text-[var(--state-danger)]">Available tenants could not be loaded.</p>
                    <button type="button" role="menuitem" disabled={isFetching} onClick={() => void refetch()}
                      className="rounded-md border border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">
                      {isFetching ? 'Retrying...' : 'Retry tenant list'}
                    </button>
                  </div>
                )}
                {isLoading && <p className="p-4 text-xs text-[var(--text-muted)]" role="status">Loading available tenants...</p>}
                {(!tenants || tenants.length === 0) && !isLoading && !isError && (
                   <div className="p-4 text-center">
                      <p className="text-[10px] font-semibold text-[var(--text-muted)]">No accessible tenants available</p>
                   </div>
                )}
              </div>

              <div className="p-3 bg-[var(--surface-elevated)] border-t border-[var(--border-subtle)]">
                 <button 
                    onClick={() => {
                        setIsOpen(false);
                        // Navigate to settings tab for multi-tenancy if admin
                        navigate('/settings?tab=tenants');
                    }}
                    role="menuitem"
                    className="w-full flex items-center justify-center gap-2 p-2 rounded-lg border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
                 >
                    <Plus size={12} /> Manage tenants
                 </button>
              </div>
            </div>,
          document.body
        )}
      {confirmation}
      <WorkspaceModal isOpen={selectMutation.isPending} onClose={() => {}} title="Switching tenant"
        hideCloseButton hideFooterClose size="standard">
        <p role="status" className="p-5 text-sm text-[var(--text-secondary)]">Finishing the tenant switch…</p>
      </WorkspaceModal>
    </div>
  )
}
