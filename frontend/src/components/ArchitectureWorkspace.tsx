import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ArchitectureHost from '../architecture/ArchitectureHost'

export default function ArchitectureWorkspace() {
  const location = useLocation(); const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const returnContext = params.get('return')
  const safeReturn = returnContext && returnContext.startsWith('/projects/') && !returnContext.includes('://') ? returnContext : null
  return <main data-workspace="architecture" data-pv1-architecture-workspace="true" className="min-h-full min-w-0 overflow-auto bg-[var(--pv1-page,var(--bg-primary,#0b1220))] p-3 sm:p-6"><header className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="m-0 text-[11px] uppercase tracking-[.14em] opacity-65">Architecture workspace</p><h1 className="mt-1 break-words text-xl sm:text-2xl">Canonical system model</h1></div>{safeReturn ? <button type="button" className="max-w-full whitespace-normal" onClick={() => navigate(safeReturn)}>Return to Project context</button> : null}</header><ArchitectureHost /></main>
}
