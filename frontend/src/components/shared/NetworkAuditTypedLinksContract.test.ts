import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const frontendRoot = path.resolve(__dirname, '../..')
const repoRoot = path.resolve(frontendRoot, '../..')
const readSource = (relativePath: string) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8')

describe('Network/Audit typed relationship navigation boundary', () => {
  it('uses the shared resolver in Audit without a page-local route map', () => {
    const source = readSource('components/AuditLogs.tsx')

    expect(source).toContain("from './shared/OperationalObjectReference'")
    expect(source).toContain('resolveOperationalObjectReference(log?.target_table, log?.target_id)')
    expect(source).toContain('resolveOperationalObjectReference(params.data?.target_table, params.data?.target_id)')
    expect(source).not.toContain('resolveAuditTarget')
    expect(source).not.toContain('`/asset?id=')
    expect(source).not.toContain('`/network?id=')
  })

  it('uses the shared resolver and golden selector for Network endpoints', () => {
    const source = readSource('components/NetworkReal.tsx')

    expect(source).toContain("from './shared/OperationalObjectReference'")
    expect(source).toContain("resolveOperationalObjectReference('device', deviceId)")
    expect(source).not.toContain('navigate(`/asset?id=')
    expect(source).toContain('<OperationalAssetSelector')
    expect(source).toContain('label="Source Device"')
    expect(source).toContain('label="Peer Device"')
    expect(source).not.toContain('NetworkAssetField')
    expect(source).toMatch(/device_a_id: item\?\.source_device_id[\s\S]*?Number\(item\.source_device_id\)/)
    expect(source).toMatch(/device_b_id: item\?\.target_device_id[\s\S]*?Number\(item\.target_device_id\)/)
  })

  it('keeps Racks outside this bounded change', () => {
    expect(() => execFileSync('git', [
      'diff',
      '--quiet',
      '39a0ee2d7b5a08004795d8207212e5347166cfac',
      '--',
      'frontend/src/components/Racks.tsx',
    ], { cwd: repoRoot })).not.toThrow()
  })
})
