import { describe, expect, it } from 'vitest'
import { orientAssetNetworkConnection } from './assetNetwork'

describe('asset network link orientation', () => {
  it('shows the selected device port first when it is the source', () => {
    expect(orientAssetNetworkConnection(1, {
      source_device_id: '1', target_device_id: 2,
      source_device_name: 'Core', target_device_name: 'Compute',
      source_port: 'eth1', target_port: 'eth0',
    })).toEqual({ isSource: true, isTarget: false, peerName: 'Compute', localPort: 'eth1', peerPort: 'eth0' })
  })

  it('reverses peer and port direction when the selected device is the target', () => {
    expect(orientAssetNetworkConnection('1', {
      source_device_id: 2, target_device_id: 1,
      source_device_name: 'Storage', target_device_name: 'Core',
      source_port: 'p2', target_port: 'sfp1',
    })).toEqual({ isSource: false, isTarget: true, peerName: 'Storage', localPort: 'sfp1', peerPort: 'p2' })
  })
})
