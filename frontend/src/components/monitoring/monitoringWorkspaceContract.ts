export const STATUSES = [
  { value: 'Existing', label: 'Existing', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { value: 'Planned', label: 'Planned', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'Cancelled', label: 'Cancelled', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  { value: 'Decommissioned', label: 'Decommissioned', color: 'bg-slate-500/20 text-slate-400 border-white/20' },
  { value: 'Deleted', label: 'Deleted', color: 'bg-slate-800 text-slate-500 border-white/5' }
]

export const LOGIC_TYPES = ['Threshold', 'Anomaly', 'Availability']

export const LOGIC_SUGGESTIONS: Record<string, string> = {
  Threshold: 'CPU > 90%',
  Anomaly: 'Trend analysis',
  Availability: 'HTTP 200 check'
}

export const getLogicExtensions = (logicType?: string) => []

export interface MonitoringLogicEntry {
  id: number
  type: string
  description: string
  logic_info: string
}

export interface MonitoringOwner {
  operator_id: number
  role: string
  name: string
  external_id: string
}

export type MonitoringFormErrors = Record<string, string>

export interface MonitoringTeamOption {
  id: number
  name: string
  operators: any[]
}

export interface OperatorRecord {
  id: number
  username: string
  full_name: string
  external_id: string
  team_id?: number
  team?: string
}

export interface MonitoringRecoveryDoc {
  id: number
  note?: string
  added_at?: string
}
