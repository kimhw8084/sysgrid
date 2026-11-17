export type OperationalHeaderWidthBounds = {
  minWidth?: number
  maxWidth?: number
}

export const applyOperationalHeaderWidthBounds = <T>(
  columns: T[],
  bounds: Record<string, OperationalHeaderWidthBounds>,
): T[] => columns.map((column) => {
  const field = (column as { field?: string } | null)?.field
  const widthBounds = field ? bounds[field] : undefined
  if (!widthBounds) return column

  const currentOperationalMinimum = (column as { operationalMinimumWidth?: number } | null)?.operationalMinimumWidth
  const operationalMinimumWidth = typeof widthBounds.minWidth === 'number'
    ? Math.max(
      typeof currentOperationalMinimum === 'number' ? currentOperationalMinimum : 0,
      widthBounds.minWidth,
    )
    : currentOperationalMinimum
  const configuredWidth = (column as { width?: number } | null)?.width
  const width = typeof configuredWidth === 'number'
    ? Math.max(
      typeof widthBounds.minWidth === 'number' ? widthBounds.minWidth : 0,
      Math.min(configuredWidth, typeof widthBounds.maxWidth === 'number' ? widthBounds.maxWidth : Number.POSITIVE_INFINITY),
    )
    : configuredWidth

  return {
    ...column,
    ...widthBounds,
    ...(typeof width === 'number' ? { width } : {}),
    ...(typeof operationalMinimumWidth === 'number' && operationalMinimumWidth > 0
      ? { operationalMinimumWidth }
      : {}),
  } as T
})
