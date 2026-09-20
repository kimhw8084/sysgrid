import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const componentsRoot = path.resolve(__dirname, '..')
const readComponent = (relativePath: string) => fs.readFileSync(path.join(componentsRoot, relativePath), 'utf8')

describe('Monitoring and Services golden capability boundaries', () => {
  it('removes MonitoringForm page coupling and leaves the selector below the page owner', () => {
    const form = readComponent('monitoring/MonitoringForm.tsx')
    const grid = readComponent('MonitoringGrid.tsx')
    const workspaceContract = readComponent('monitoring/monitoringWorkspaceContract.ts')
    const service = readComponent('ServiceRegistry.tsx')
    const numericContract = fs.readFileSync(path.join(componentsRoot, '../domain/monitoringContract.ts'), 'utf8')

    expect(form).not.toContain("from '../MonitoringGrid'")
    expect(grid).not.toContain('MonitoringAssetField')
    expect(grid).toContain("from './monitoring/monitoringWorkspaceContract'")
    expect(form).toContain("from './monitoringWorkspaceContract'")
    expect(form).toContain("from '../../domain/monitoringContract'")
    expect(workspaceContract).not.toMatch(/CHECK_INTERVAL_(MIN|MAX)\s*=/)
    expect(workspaceContract).not.toMatch(/ALERT_DURATION_(MIN|MAX)\s*=/)
    expect(workspaceContract).not.toMatch(/NOTIFICATION_THROTTLE_(MIN|MAX)\s*=/)
    expect(numericContract).toContain('contracts/monitoring_domain_contract_v1.json')
    expect(service).toContain("import { OperationalAssetSelector } from './shared/OperationalAssetSelector'")
    expect(service).not.toContain('const hostOptions')
    expect(service).toContain("onChange={(deviceId) => updateField('device_id', deviceId)}")
  })
})
