import { apiFetch } from '../../api/apiClient'

/** Asset choices retain canonical defaults, configured labels and recorded values. */
export const ASSET_STATUSES = ['Planned', 'Active', 'Maintenance', 'Standby', 'Failed', 'Decommissioned', 'Provisioning', 'Reserved', 'Deleted']
export const ASSET_ENVIRONMENTS = ['Production', 'Staging', 'QA', 'Dev', 'DR', 'Lab', 'Sandbox', 'Legacy']
export const ASSET_TYPES = ['Physical', 'Virtual', 'Storage', 'Switch', 'Firewall', 'Load Balancer', 'PDU', 'UPS', 'Console-Server', 'Patch Panel']

export async function fetchAssetSettingOptions(): Promise<Array<{ category: string; value: string; label?: string }>> {
  const response = await apiFetch('/api/v1/settings/options')
  if (!response.ok) throw new Error('Configured asset choices could not be loaded.')
  const options = await response.json()
  if (!Array.isArray(options)) throw new Error('Configured asset choices could not be loaded.')
  return options
}

export function assetFilterOptions(defaults: readonly string[], configured: Array<{ value?: unknown; label?: unknown }>, recorded: unknown[]) {
  const choices = new Map(defaults.map(value => [value, value]))
  for (const option of configured) {
    if (typeof option.value === 'string' && option.value.trim()) {
      choices.set(option.value, typeof option.label === 'string' && option.label.trim() ? option.label : option.value)
    }
  }
  for (const value of recorded) {
    if (typeof value === 'string' && value.trim() && !choices.has(value)) choices.set(value, value)
  }
  return [...choices].map(([value, label]) => ({ value, label }))
}
