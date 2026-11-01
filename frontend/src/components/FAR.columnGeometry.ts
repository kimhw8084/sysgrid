import { OPERATIONAL_GRID_MIN_COLUMN_WIDTH } from './shared/OperationalGridContract'

export type FarGoldenColumnGeometry = {
  colId: string
  headerName: string
  defaultWidth: number
  minWidth: number
  dynamicDefault?: boolean
}

export const FAR_GOLDEN_COLUMN_GEOMETRY: readonly FarGoldenColumnGeometry[] = [
  { colId: 'system_name', headerName: 'System', defaultWidth: 132, minWidth: 120, dynamicDefault: true },
  { colId: 'failure_type', headerName: 'Type', defaultWidth: 108, minWidth: 96, dynamicDefault: true },
  { colId: 'title', headerName: 'Failure Mode', defaultWidth: 260, minWidth: 200, dynamicDefault: true },
  { colId: 'severity', headerName: 'S', defaultWidth: 72, minWidth: 68 },
  { colId: 'occurrence', headerName: 'O', defaultWidth: 84, minWidth: 84 },
  { colId: 'detection', headerName: 'D', defaultWidth: 72, minWidth: 68 },
  { colId: 'rpn', headerName: 'RPN', defaultWidth: 130, minWidth: 130 },
  { colId: 'status', headerName: 'Maturity', defaultWidth: 164, minWidth: 152 },
  { colId: 'vectors', headerName: 'Vectors', defaultWidth: 160, minWidth: 140 },
  { colId: 'linked_rcas', headerName: 'Incidents', defaultWidth: 120, minWidth: 112 },
  { colId: 'created_by_user_id', headerName: 'Created By', defaultWidth: 136, minWidth: 128, dynamicDefault: true },
] as const

export const FAR_GOLDEN_COLUMN_GEOMETRY_BY_ID = new Map(
  FAR_GOLDEN_COLUMN_GEOMETRY.map((entry) => [entry.colId, entry] as const)
)

export const FAR_GOLDEN_COLUMN_GEOMETRY_FINGERPRINT = FAR_GOLDEN_COLUMN_GEOMETRY.map((entry) => ({
  colId: entry.colId,
  headerName: entry.headerName,
  defaultWidth: entry.defaultWidth,
  minWidth: entry.minWidth,
  dynamicDefault: Boolean(entry.dynamicDefault),
}))

export function sanitizeFarPersistedColumnGeometry(layout: any[]) {
  const repairedColumnIds: string[] = []
  const sanitized = (Array.isArray(layout) ? layout : []).map((column: any) => {
    const geometry = FAR_GOLDEN_COLUMN_GEOMETRY_BY_ID.get(String(column?.colId || ''))
    if (!geometry) return column
    const width = Number(column?.width)
    if (!Number.isFinite(width) || width >= OPERATIONAL_GRID_MIN_COLUMN_WIDTH) return column
    repairedColumnIds.push(geometry.colId)
    const recovered = {
      ...column,
      width: geometry.defaultWidth,
    }
    delete recovered.flex
    return recovered
  })
  return {
    layout: sanitized,
    repairedColumnIds,
  }
}

export function buildFarGoldenGeometryResetState(columnDefs: any[]) {
  return (Array.isArray(columnDefs) ? columnDefs : []).flatMap((definition: any) => {
    const colId = String(definition?.colId || definition?.field || '')
    if (!colId) return []
    const geometry = FAR_GOLDEN_COLUMN_GEOMETRY_BY_ID.get(colId)
    if (!geometry) return [{ colId }]
    const dynamicWidth = Number(definition?.width)
    const width = Number.isFinite(dynamicWidth) && dynamicWidth >= geometry.minWidth
      ? dynamicWidth
      : geometry.defaultWidth
    return [{
      colId,
      hide: false,
      pinned: definition?.pinned ?? null,
      width,
    }]
  })
}
