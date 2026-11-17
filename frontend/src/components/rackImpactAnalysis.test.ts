import { describe, expect, it } from 'vitest'
import { buildRackImpactAnalysis } from './rackImpactAnalysis'

describe('rack impact analysis', () => {
  it('resolves numeric and string device ids and orients every link from the selected asset', () => {
    const result = buildRackImpactAnalysis('1', [
      { id: 1, name: 'Core router', type: 'switch', system: 'Network', status: 'Active' },
      { id: 2, name: 'Compute A', type: 'server', system: 'Compute', status: 'Active' },
      { id: 3, name: 'Storage A', type: 'storage', system: 'Compute', status: 'Offline' },
    ], [
      { id: 'forward', source_device_id: 1, target_device_id: 2, source_port: 'eth1', target_port: 'eth0', speed_gbps: 10 },
      { id: 'reverse', source_device_id: '3', target_device_id: '1', source_port: 'p2', target_port: 'sfp1', speed_gbps: 25 },
      { id: 'unrelated', source_device_id: 2, target_device_id: 3 },
    ])

    expect(result.device?.name).toBe('Core router')
    expect(result.connections).toHaveLength(2)
    expect(result.peerCount).toBe(2)
    expect(result.connectedSystemCount).toBe(1)
    expect(result.peers.map(({ peer, localPort, peerPort }) => [peer?.name, localPort, peerPort])).toEqual([
      ['Compute A', 'eth1', 'eth0'],
      ['Storage A', 'sfp1', 'p2'],
    ])
    expect(result.distribution.type).toMatchObject({ server: 1, storage: 1 })
  })

  it('keeps missing peers visible as unknown and tolerates absent endpoint fields', () => {
    const result = buildRackImpactAnalysis(9, [], [
      { id: 1, source_device_id: 9, target_device_id: 10 },
      { id: 2, source_device_id: 9, target_device_id: 10 },
    ])

    expect(result.connections).toHaveLength(2)
    expect(result.peerCount).toBe(1)
    expect(result.connectedSystemCount).toBe(0)
    expect(result.distribution.system).toEqual({ Unknown: 2 })
    expect(result.peers[0]).toMatchObject({ peer: null, localPort: undefined, peerPort: undefined })
  })
})
