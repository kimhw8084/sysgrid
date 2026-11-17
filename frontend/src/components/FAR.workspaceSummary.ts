import { getFarRiskBand } from './FAR.workspaceModel'

export function buildFarWorkspaceSummary(modes: unknown) {
  const records = Array.isArray(modes) ? modes as any[] : []
  const totalRPN = records.reduce((sum, mode) => {
    const value = Number(mode?.rpn)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
  const mitigatedCount = records.filter((mode) => Array.isArray(mode?.mitigations) && mode.mitigations.length > 0).length
  const systems = new Set(records.flatMap((mode) => {
    const value = typeof mode?.system_name === 'string' ? mode.system_name.trim() : ''
    return value ? [value.toLocaleLowerCase()] : []
  }))

  return {
    recordCount: records.length,
    averageRPN: records.length ? totalRPN / records.length : 0,
    criticalCount: records.filter((mode) => getFarRiskBand(mode) === 'critical').length,
    priorityCount: records.filter((mode) => getFarRiskBand(mode) !== 'controlled').length,
    mitigationCount: mitigatedCount,
    mitigationRatio: records.length ? Math.round((mitigatedCount / records.length) * 100) : 0,
    systemsCovered: systems.size,
    totalRPN,
    totalAffectedAssets: records.reduce((sum, mode) => sum + (Array.isArray(mode?.affected_assets) ? mode.affected_assets.length : 0), 0),
  }
}
