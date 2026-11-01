import { buildOperationalGroupSections } from './shared/OperationalGrouping'

export type FarGroupBy = 'raw' | 'system_name' | 'failure_type' | 'status' | 'risk_band'

export type FarQuickFilters = {
  system_name: string[]
  failure_type: string[]
  status: string[]
  risk_band: string[]
}

export const FAR_GROUP_OPTIONS: Array<{ value: FarGroupBy; label: string }> = [
  { value: 'raw', label: 'Raw Rows' },
  { value: 'system_name', label: 'System' },
  { value: 'failure_type', label: 'Failure Type' },
  { value: 'status', label: 'Status' },
  { value: 'risk_band', label: 'RPN Risk Band' },
]

export const FAR_VALID_GROUP_BY = new Set<FarGroupBy>(FAR_GROUP_OPTIONS.map((option) => option.value))

export const FAR_RISK_BAND_OPTIONS = [
  { value: 'critical', label: 'Critical · RPN ≥ 150' },
  { value: 'elevated', label: 'Elevated · RPN 80–149' },
  { value: 'controlled', label: 'Controlled · RPN < 80' },
] as const

export const createDefaultFarQuickFilters = (): FarQuickFilters => ({
  system_name: [],
  failure_type: [],
  status: [],
  risk_band: [],
})

const normalizeStrings = (value: unknown, limit: number = 200) => {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
  )).slice(0, limit)
}

export const normalizeFarQuickFilters = (value: unknown): FarQuickFilters => {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    system_name: normalizeStrings(source.system_name),
    failure_type: normalizeStrings(source.failure_type),
    status: normalizeStrings(source.status),
    risk_band: normalizeStrings(source.risk_band),
  }
}

export const getFarRiskBand = (mode: any): 'critical' | 'elevated' | 'controlled' => {
  const rpn = Number(mode?.rpn || 0)
  if (rpn >= 150) return 'critical'
  if (rpn >= 80) return 'elevated'
  return 'controlled'
}

export const getFarRiskBandLabel = (mode: any) => (
  FAR_RISK_BAND_OPTIONS.find((option) => option.value === getFarRiskBand(mode))?.label || 'Controlled · RPN < 80'
)

const farSearchHaystack = (mode: any) => [
  mode?.id ? `FAR-${mode.id}` : '',
  mode?.id,
  mode?.system_name,
  mode?.failure_type,
  mode?.title,
  mode?.effect,
  mode?.status,
  mode?.created_by_user_id,
  JSON.stringify(mode?.affected_assets || []),
  JSON.stringify(mode?.causes || []),
  JSON.stringify(mode?.mitigations || []),
  JSON.stringify(mode?.prevention_actions || []),
  JSON.stringify(mode?.linked_rcas || []),
].filter(Boolean).join(' ').toLowerCase()

export const filterFarModes = (
  modes: any[] | undefined,
  searchTerm: string,
  quickFilters: FarQuickFilters
) => {
  const query = searchTerm.trim().toLowerCase()
  return (modes || []).filter((mode) => {
    if (query && !farSearchHaystack(mode).includes(query)) return false
    if (quickFilters.system_name.length && !quickFilters.system_name.includes(String(mode?.system_name || ''))) return false
    if (quickFilters.failure_type.length && !quickFilters.failure_type.includes(String(mode?.failure_type || ''))) return false
    if (quickFilters.status.length && !quickFilters.status.includes(String(mode?.status || ''))) return false
    if (quickFilters.risk_band.length && !quickFilters.risk_band.includes(getFarRiskBand(mode))) return false
    return true
  })
}

export const getFarGroupValue = (mode: any, groupBy: FarGroupBy) => {
  if (groupBy === 'risk_band') return getFarRiskBandLabel(mode)
  if (groupBy === 'system_name') return String(mode?.system_name ?? 'Unspecified System')
  if (groupBy === 'failure_type') return String(mode?.failure_type ?? 'Unspecified Type')
  if (groupBy === 'status') return String(mode?.status ?? 'Unspecified Status')
  return 'Raw Rows'
}

export const groupFarModes = (modes: any[], groupBy: FarGroupBy) => {
  const sections = buildOperationalGroupSections(modes, groupBy, mode => getFarGroupValue(mode, groupBy))
  if (groupBy === 'risk_band') {
    const order = new Map<string, number>(FAR_RISK_BAND_OPTIONS.map((option, index) => [option.label, index]))
    return sections.sort((a, b) => (order.get(a.label) ?? 999) - (order.get(b.label) ?? 999))
  }
  return sections.sort((a, b) => a.label.localeCompare(b.label))
}

const escapeDelimited = (value: unknown, delimiter: ',' | '\t') => {
  const text = value == null ? '' : String(value)
  if (delimiter === '\t') return text.replace(/[\t\r\n]+/g, ' ')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const buildFarDelimitedText = (rows: any[], delimiter: ',' | '\t') => {
  const columns: Array<[string, (mode: any) => unknown]> = [
    ['ID', (mode) => `FAR-${mode?.id ?? ''}`],
    ['System', (mode) => mode?.system_name],
    ['Type', (mode) => mode?.failure_type],
    ['Failure Mode', (mode) => mode?.title],
    ['Severity', (mode) => mode?.severity],
    ['Occurrence', (mode) => mode?.occurrence],
    ['Detection', (mode) => mode?.detection],
    ['RPN', (mode) => mode?.rpn],
    ['Status', (mode) => mode?.status],
    ['Risk Band', (mode) => getFarRiskBandLabel(mode)],
    ['Incidents', (mode) => mode?.linked_rcas?.length || 0],
    ['Created By', (mode) => mode?.created_by_user_id || 'SYSTEM'],
  ]
  return [
    columns.map(([label]) => escapeDelimited(label, delimiter)).join(delimiter),
    ...rows.map((mode) => columns.map(([, read]) => escapeDelimited(read(mode), delimiter)).join(delimiter)),
  ].join('\n')
}
