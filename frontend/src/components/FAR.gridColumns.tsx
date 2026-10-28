import React from 'react'
import {
  OPERATIONAL_GRID_BADGE_CLASS,
  OPERATIONAL_GRID_BADGE_TEXT_CLASS,
  OPERATIONAL_GRID_CLASSES,
} from './shared/OperationalGridContract'
import {
  OperationalLinkedCountCell,
  getOperationalHeaderSafeMinWidth,
} from './shared/OperationalGoldenColumns'

export type FarAnalyticalIncident = {
  id?: string | number
  title?: string
  [key: string]: any
}

export type FarAnalyticalMode = {
  status?: string
  mitigations?: Array<{ mitigation_type?: string; [key: string]: any }>
  causes?: Array<{ resolutions?: unknown[]; [key: string]: any }>
  prevention_actions?: unknown[]
  linked_rcas?: FarAnalyticalIncident[]
  [key: string]: any
}

export type FarMaturityLevelDefinition = {
  lv: number
  label: string
  desc: string
  color: string
  tooltip: string
}

export const FAR_MATURITY_LEVELS: ReadonlyArray<FarMaturityLevelDefinition> = [
  { lv: 8, label: 'Prevented', desc: 'Eliminated / Design Proofed', color: 'bg-emerald-500', tooltip: 'DESIGN PROOF: Failure mode eliminated by architectural change or permanent hardware/software design proofing.' },
  { lv: 7, label: 'Triple Shield', desc: 'Monitoring + Resolution + Workaround', color: 'bg-emerald-400', tooltip: 'TRIPLE SHIELD: Full defense-in-depth. Automated detection, immediate workaround, and verified BKM are all active.' },
  { lv: 6, label: 'Automated Fix', desc: 'Monitoring + Resolution', color: 'bg-sky-500', tooltip: 'STABLE DEFENSE: Monitoring identifies failure and a permanent BKM fix is available. Lacks an immediate temporary workaround.' },
  { lv: 5, label: 'Hybrid Patch', desc: 'Resolution + Workaround', color: 'bg-sky-400', tooltip: 'HYBRID PATCH: Permanent fix and temporary workaround identified. Lacks automated monitoring to detect onset.' },
  { lv: 4, label: 'Resolved Only', desc: 'Manual Permanent Fix', color: 'bg-blue-500', tooltip: 'RESOLUTION ONLY: A verified permanent fix exists, but failure is silent (no monitoring) and has no immediate workaround.' },
  { lv: 3, label: 'Detect & Patch', desc: 'Monitoring + Workaround', color: 'bg-amber-500', tooltip: 'DETECT & PATCH: Monitoring provides visibility and a workaround reduces impact, but no permanent BKM has been identified.' },
  { lv: 2, label: 'Workaround Only', desc: 'Temporary Patch Only', color: 'bg-amber-400', tooltip: 'WORKAROUND ONLY: A temporary patch exists for recovery, but we are blind to failure onset (no monitoring).' },
  { lv: 1, label: 'Visibility Only', desc: 'Monitoring Without Action', color: 'bg-rose-400', tooltip: 'MONITORING ONLY: We can see the failure occurring via telemetry, but have no workaround or permanent resolution playbook.' },
  { lv: 0, label: 'Exposed', desc: 'No Monitoring / No Action', color: 'bg-rose-600', tooltip: 'SYSTEM EXPOSED: Critical blind spot. No telemetry, no workaround, and no permanent resolution identified. High risk.' },
]

export function getFarMaturityLevel(mode: FarAnalyticalMode) {
  const hasVerifiedPrevention = (mode.prevention_actions || []).some((action: any) =>
    action?.status === 'Verified' || action?.status === 'Completed'
  )
  if (mode.status === 'Prevented' || hasVerifiedPrevention) return 8
  const hasMonitoring = mode.mitigations?.some((mitigation) => mitigation.mitigation_type === 'Monitoring') || false
  const hasWorkaround = mode.mitigations?.some((mitigation) => mitigation.mitigation_type === 'Workaround') || false
  const hasResolution = mode.causes?.some((cause) => (cause.resolutions?.length || 0) > 0) || false

  if (hasMonitoring && hasResolution && hasWorkaround) return 7
  if (hasMonitoring && hasResolution) return 6
  if (hasResolution && hasWorkaround) return 5
  if (hasResolution) return 4
  if (hasMonitoring && hasWorkaround) return 3
  if (hasWorkaround) return 2
  if (hasMonitoring) return 1
  return 0
}

export function getFarVectorSummary(mode: FarAnalyticalMode) {
  const mitigations = mode.mitigations || []
  const causes = mode.causes || []
  return {
    causes: causes.length,
    resolutions: causes.reduce((count, cause) => count + (cause.resolutions?.length || 0), 0),
    workarounds: mitigations.filter((mitigation) => mitigation.mitigation_type === 'Workaround').length,
    monitoring: mitigations.filter((mitigation) => mitigation.mitigation_type === 'Monitoring').length,
    prevention: (mode.prevention_actions || []).length,
  }
}

export function getFarIncidentToneClass(count: number) {
  if (count >= 5) return 'bg-rose-500/20 text-rose-500 border-rose-500/30'
  if (count >= 2) return 'bg-amber-500/20 text-amber-500 border-amber-500/30'
  return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
}

type FarRendererColumnConfig = {
  field?: string
  colId?: string
  headerName: string
  width: number
  minWidth: number
  filter?: any
  hide?: boolean
  cellRenderer: (params: any) => React.ReactNode
}

function createFarOperationalRendererColumn({
  field,
  colId,
  headerName,
  width,
  minWidth,
  filter,
  hide,
  cellRenderer,
}: FarRendererColumnConfig) {
  return {
    ...(field ? { field } : {}),
    ...(colId ? { colId } : {}),
    headerName,
    width,
    minWidth: getOperationalHeaderSafeMinWidth({ headerName, minWidth }),
    suppressAutoSize: true,
    operationalSkipAutoSize: true,
    resizable: true,
    cellClass: OPERATIONAL_GRID_CLASSES.centeredCell,
    headerClass: OPERATIONAL_GRID_CLASSES.centeredHeader,
    ...(filter !== undefined ? { filter } : {}),
    cellRenderer,
    ...(hide !== undefined ? { hide } : {}),
  }
}

function FarVectorBadge({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="flex min-w-[24px] flex-col items-center">
      <span className="mb-0.5 text-[7px] font-bold uppercase leading-none text-slate-500">{label}</span>
      <span className={`text-[10px] font-bold leading-none ${color}`}>{value}</span>
    </div>
  )
}

export function createFarMaturityColumn({
  fontSize,
  hidden,
  onOpenMaturity,
}: {
  fontSize: number
  hidden: boolean
  onOpenMaturity: () => void
}) {
  return createFarOperationalRendererColumn({
    field: 'status',
    headerName: 'Maturity',
    width: 164,
    minWidth: 152,
    filter: 'agTextColumnFilter',
    hide: hidden,
    cellRenderer: (params: any) => {
      const level = getFarMaturityLevel(params.data || {})
      const maturity = FAR_MATURITY_LEVELS.find((candidate) => candidate.lv === level) || FAR_MATURITY_LEVELS[FAR_MATURITY_LEVELS.length - 1]
      const colorClass = maturity.lv >= 6
        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
        : maturity.lv >= 4
          ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
          : maturity.lv >= 1
            ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            : 'bg-rose-500/20 text-rose-400 border-rose-500/30'

      return (
        <div className="flex h-full w-full items-center justify-center">
          <div
            onClick={onOpenMaturity}
            title={`Lv${maturity.lv} ${maturity.label}`}
            className={`${OPERATIONAL_GRID_BADGE_CLASS} cursor-pointer transition-transform hover:scale-[1.02] ${colorClass}`}
          >
            <span
              style={{ fontSize: `${fontSize}px` }}
              className={`${OPERATIONAL_GRID_BADGE_TEXT_CLASS} font-bold uppercase tracking-tight`}
            >
              Lv{maturity.lv} {maturity.label}
            </span>
          </div>
        </div>
      )
    },
  })
}

export function createFarVectorsColumn({ hidden }: { hidden: boolean }) {
  return createFarOperationalRendererColumn({
    colId: 'vectors',
    headerName: 'Vectors',
    width: 160,
    minWidth: 140,
    hide: hidden,
    cellRenderer: (params: any) => {
      const summary = getFarVectorSummary(params.data || {})
      return (
        <div className="flex h-full items-center justify-center gap-2">
          <FarVectorBadge label="C/R" value={`${summary.causes}/${summary.resolutions}`} color="text-blue-400" />
          <div className="h-3 w-px bg-white/10" />
          <FarVectorBadge label="W" value={summary.workarounds} color="text-amber-400" />
          <div className="h-3 w-px bg-white/10" />
          <FarVectorBadge label="M" value={summary.monitoring} color="text-sky-400" />
          <div className="h-3 w-px bg-white/10" />
          <FarVectorBadge label="P" value={summary.prevention} color="text-emerald-400" />
        </div>
      )
    },
  })
}

export function createFarIncidentsColumn({
  fontSize,
  hidden,
  onOpenIncidents,
}: {
  fontSize: number
  hidden: boolean
  onOpenIncidents: (incidents: FarAnalyticalIncident[]) => void
}) {
  return createFarOperationalRendererColumn({
    field: 'linked_rcas',
    headerName: 'Incidents',
    width: 144,
    minWidth: 136,
    hide: hidden,
    cellRenderer: (params: any) => {
      const incidents: FarAnalyticalIncident[] = params.data?.linked_rcas || []
      return (
        <OperationalLinkedCountCell
          items={incidents}
          fontSize={fontSize}
          emptyLabel="None"
          previewTitle="Linked RCA Records"
          getItemKey={(incident, index) => incident.id ?? `incident-${index}`}
          getItemLabel={(incident) => incident.title}
          getToneClass={getFarIncidentToneClass}
          onActivate={onOpenIncidents}
        />
      )
    },
  })
}

export function createFarAnalyticalColumns({
  fontSize,
  hiddenColumns,
  onOpenMaturity,
  onOpenIncidents,
}: {
  fontSize: number
  hiddenColumns: string[]
  onOpenMaturity: () => void
  onOpenIncidents: (incidents: FarAnalyticalIncident[]) => void
}) {
  return [
    createFarMaturityColumn({
      fontSize,
      hidden: hiddenColumns.includes('status'),
      onOpenMaturity,
    }),
    createFarVectorsColumn({ hidden: hiddenColumns.includes('vectors') }),
    createFarIncidentsColumn({
      fontSize,
      hidden: hiddenColumns.includes('linked_rcas'),
      onOpenIncidents,
    }),
  ]
}
