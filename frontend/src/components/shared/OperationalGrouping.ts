export type OperationalGroupSection<T> = {
  key: string
  label: string
  items: T[]
}

export function reconcileCollapsedOperationalGroups(
  current: Record<string, boolean>,
  sections: ReadonlyArray<{ key: string }>,
): Record<string, boolean> {
  const activeKeys = new Set<string>()
  let changed = false
  const next = { ...current }
  let hasDefaultOpenGroup = false

  sections.forEach(({ key }) => {
    activeKeys.add(key)
    if (!Object.prototype.hasOwnProperty.call(current, key) || typeof current[key] !== 'boolean') {
      // Mount one grid immediately; keep the rest available behind their group
      // headers so high-cardinality grouping never creates dozens of grids.
      next[key] = hasDefaultOpenGroup
      changed = true
    }
    hasDefaultOpenGroup = true
  })

  Object.keys(current).forEach((key) => {
    if (activeKeys.has(key)) return
    delete next[key]
    changed = true
  })

  return changed ? next : current
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
