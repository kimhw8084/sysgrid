export type AssetWorkSignalLevel = 'attention' | 'active' | 'scheduled' | 'history' | 'none'

export type AssetWorkSignal = {
  level: AssetWorkSignalLevel
  label: string
  scheduledWindows: any[]
  actions: any[]
  attentionActions: any[]
  activeActions: any[]
}

const ATTENTION_STATUSES = new Set([
  'FAILED',
  'VERIFICATION_FAILED',
  'ROLLBACK_FAILED',
  'RECOVERY_REQUIRED',
])

const ACTIVE_STATUSES = new Set([
  'EXECUTING',
  'ROLLBACK_REQUESTED',
  'ROLLING_BACK',
])

export function getAssetWorkSignal(
  assetId: number,
  windows: readonly any[] = [],
  actions: readonly any[] = [],
  now = Date.now(),
): AssetWorkSignal {
  const normalizedId = Number(assetId)
  const assetWindows = windows.filter((window) => Number(window?.device_id) === normalizedId)
  const scheduledWindows = assetWindows.filter((window) => {
    if (window?.cancelled_at || ['cancelled', 'canceled'].includes(String(window?.status || '').trim().toLowerCase())) return false
    const endTime = Date.parse(String(window?.end_time || ''))
    return !Number.isFinite(endTime) || endTime >= now
  })
  const assetActions = actions.filter((action) => Array.isArray(action?.targets)
    && action.targets.some((target: any) => Number(target?.device_id) === normalizedId))
  const attentionActions = assetActions.filter((action) => ATTENTION_STATUSES.has(String(action?.status || '').toUpperCase()))
  const activeActions = assetActions.filter((action) => ACTIVE_STATUSES.has(String(action?.status || '').toUpperCase()))

  const level: AssetWorkSignalLevel = attentionActions.length
    ? 'attention'
    : activeActions.length
      ? 'active'
      : scheduledWindows.length
        ? 'scheduled'
        : assetActions.length || assetWindows.length
          ? 'history'
          : 'none'

  const label = level === 'attention' ? 'Needs attention'
    : level === 'active' ? 'Work active'
      : level === 'scheduled' ? 'Work scheduled'
        : level === 'history' ? 'Work recorded'
          : 'No work recorded'

  return { level, label, scheduledWindows, actions: assetActions, attentionActions, activeActions }
}
