export type OperationalGroupSection<T> = {
  key: string
  label: string
  items: T[]
}

export function buildOperationalGroupSections<T>(
  items: readonly T[],
  groupBy: string,
  getValue: (item: T) => unknown,
  fallback = 'Unspecified',
): OperationalGroupSection<T>[] {
  if (!groupBy || groupBy === 'raw') return []

  const grouped = new Map<string, T[]>()
  items.forEach((item) => {
    const value = getValue(item)
    const label = typeof value === 'string'
      ? value.trim() || fallback
      : value == null
        ? fallback
        : String(value)
    const current = grouped.get(label)
    if (current) current.push(item)
    else grouped.set(label, [item])
  })

  return Array.from(grouped, ([label, groupedItems]) => ({ key: `${groupBy}:${label}`, label, items: groupedItems }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' }))
}
