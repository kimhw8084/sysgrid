import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../../../..')
const inventory = JSON.parse(fs.readFileSync(path.join(repoRoot, 'contracts/monitoring_feature_preservation_v1.json'), 'utf8'))
const monitoringSource = fs.readFileSync(path.join(repoRoot, 'frontend/src/components/MonitoringGrid.tsx'), 'utf8')

describe('Monitoring preservation harness inventory', () => {
  it('contains the bounded feature inventory and explicit expected release changes', () => {
    expect(inventory.monitoring_inner_workspace_change).toBe('none')
    expect(inventory.features).toHaveLength(17)
    expect(inventory.expected_release_changes).toHaveLength(3)
    expect(inventory.accepted_geometry.grid_width_owner).toContain('OperationalGridContract.ts')
  })

  it('keeps the real Monitoring owner wired to the preserved feature families', () => {
    for (const marker of [
      'OperationalSavedViewsPanel',
      'useOperationalGroupedSelection',
      'OperationalBulkPreviewModal',
      'MonitoringHistoryModal',
      'CompareMonitorsModal',
      'BkmListModal',
      'MonitoringDetailModal',
      'import',
      'export',
    ]) {
      expect(monitoringSource).toContain(marker)
    }
  })
})
