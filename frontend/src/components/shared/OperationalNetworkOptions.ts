export const NETWORK_LINK_TYPE_DEFAULTS = ['Data', 'Management', 'Storage', 'Backup', 'Control', 'Voice', 'Production']
export const NETWORK_FARM_DEFAULTS = ['Prod', 'Stage', 'Lab']
export const NETWORK_CABLE_TYPE_DEFAULTS = ['Fiber', 'Copper', 'Cat6', 'DAC', 'AOC']

export function getOperationalNetworkOptions(
  settingsOptions: unknown,
  category: string,
  defaults: readonly string[],
) {
  const configured = Array.isArray(settingsOptions)
    ? settingsOptions
        .filter((option: any) => option?.category === category && typeof option?.value === 'string' && option.value.trim())
        .map((option: any) => ({
          value: option.value,
          label: typeof option.label === 'string' && option.label.trim() ? option.label : option.value,
        }))
    : []
  return configured.length ? configured : defaults.map(value => ({ value, label: value }))
}
