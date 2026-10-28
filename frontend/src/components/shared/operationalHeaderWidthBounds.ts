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
  return widthBounds ? { ...column, ...widthBounds } as T : column
})
