/** Submit only user changes; display defaults never rewrite untouched legacy fields. */
export function changedNetworkFields<T extends Record<string, unknown>>(current: T, baseline: T): Partial<T> {
  return Object.fromEntries(Object.entries(current).filter(([key, value]) => !Object.is(value, baseline[key]))) as Partial<T>
}

export function networkOptionsWithCurrent(options: Array<{ value: string; label: string }>, current?: string) {
  if (!current || options.some(option => option.value === current)) return options
  return [...options, { value: current, label: `${current} · current value` }]
}
const NETWORK_TABLE_FIELDS = ['status', 'link_type', 'direction', 'farm', 'purpose', 'speed_gbps', 'unit', 'cable_type', 'request_link'] as const

export function networkTableChanges(row: Record<string, any>, baseline: Record<string, any>) {
  return Object.fromEntries(NETWORK_TABLE_FIELDS.filter(key => !Object.is(row[key], baseline[key])).map(key => [key,
    key === 'speed_gbps' ? (row[key] === '' ? null : Number(row[key])) : (row[key] || null),
  ]))
}
