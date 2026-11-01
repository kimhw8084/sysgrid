import React from 'react'
import { Network } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import ArchitectureHost from '../architecture/ArchitectureHost'
import { PageHeader } from './shared/LayoutPrimitives'

export default function ArchitectureWorkspace() {
  const location = useLocation(); const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const returnContext = params.get('return')
  const safeReturn = returnContext && returnContext.startsWith('/projects/') && !returnContext.includes('://') ? returnContext : null
  return <main data-workspace="architecture" data-golden-workspace="architecture" data-pv1-architecture-workspace="true" className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-auto bg-[var(--pv1-page,var(--bg-primary,#0b1220))]"><PageHeader eyebrow="Infrastructure" title="Architecture" titleIcon={Network} subtitle="Canonical system model and infrastructure relationships." actions={safeReturn ? <button type="button" className="max-w-full whitespace-normal" onClick={() => navigate(safeReturn)}>Return to Project context</button> : null} /><div className="min-h-0 min-w-0 flex-1"><ArchitectureHost /></div></main>
}
