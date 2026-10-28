export type OperationalDataNotice = {
  tone?: 'info' | 'warning' | 'error'
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  isActionLoading?: boolean
}

export type OperationalDataState =
  | { kind: 'ready'; noRowsLabel: string; title?: string; description?: string; notice?: OperationalDataNotice }
  | { kind: 'loading'; noRowsLabel: string; title?: string; description?: string; notice?: OperationalDataNotice }
  | { kind: 'query-error'; noRowsLabel: string; title: string; description: string; notice?: OperationalDataNotice }
  | { kind: 'raw-empty'; noRowsLabel: string; title?: string; description?: string; notice?: OperationalDataNotice }
  | { kind: 'filtered-empty'; noRowsLabel: string; title?: string; description?: string; notice?: OperationalDataNotice }
  | { kind: 'active-empty'; noRowsLabel: string; title?: string; description?: string; notice?: OperationalDataNotice }
  | { kind: 'deleted-empty'; noRowsLabel: string; title?: string; description?: string; notice?: OperationalDataNotice }

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object' && typeof (error as any).message === 'string' && (error as any).message.trim()) {
    return (error as any).message.trim()
  }
  return fallback
}

export function resolveOperationalDataState({
  loading,
  error,
  totalCount,
  tabCount,
  visibleCount,
  emptyLabel,
  filteredLabel,
  tabEmptyKind,
  tabEmptyLabel,
  errorTitle,
  errorDescription,
  emptyTitle,
  emptyDescription,
  filteredTitle,
  filteredDescription,
  tabEmptyTitle,
  tabEmptyDescription,
  degradedNotice,
}: {
  loading: boolean
  error?: unknown
  totalCount: number
  tabCount: number
  visibleCount: number
  emptyLabel: string
  filteredLabel: string
  tabEmptyKind: 'active-empty' | 'deleted-empty'
  tabEmptyLabel: string
  errorTitle: string
  errorDescription: string
  emptyTitle?: string
  emptyDescription?: string
  filteredTitle?: string
  filteredDescription?: string
  tabEmptyTitle?: string
  tabEmptyDescription?: string
  degradedNotice?: OperationalDataNotice
}): OperationalDataState {
  if (loading) return { kind: 'loading', noRowsLabel: emptyLabel, notice: degradedNotice }
  if (error) {
    return {
      kind: 'query-error',
      noRowsLabel: emptyLabel,
      title: errorTitle,
      description: getErrorMessage(error, errorDescription),
      notice: degradedNotice,
    }
  }
  if (totalCount === 0) {
    return {
      kind: 'raw-empty',
      noRowsLabel: emptyLabel,
      title: emptyTitle,
      description: emptyDescription,
      notice: degradedNotice,
    }
  }
  if (tabCount === 0) {
    return {
      kind: tabEmptyKind,
      noRowsLabel: tabEmptyLabel,
      title: tabEmptyTitle,
      description: tabEmptyDescription,
      notice: degradedNotice,
    }
  }
  if (visibleCount === 0) {
    return {
      kind: 'filtered-empty',
      noRowsLabel: filteredLabel,
      title: filteredTitle,
      description: filteredDescription,
      notice: degradedNotice,
    }
  }
  return { kind: 'ready', noRowsLabel: emptyLabel, notice: degradedNotice }
}
