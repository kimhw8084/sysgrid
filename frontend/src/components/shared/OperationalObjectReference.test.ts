import { describe, expect, it } from 'vitest'
import {
  createOperationalObjectReference,
  resolveOperationalObjectNavigation,
  resolveOperationalObjectReference,
} from './OperationalObjectReference'

describe('OperationalObjectReference', () => {
  it('resolves the V1 object types to their canonical module routes', () => {
    expect(resolveOperationalObjectReference('device', 42)).toEqual({ moduleId: 'assets', path: '/asset?id=42' })
    expect(resolveOperationalObjectReference('service', 'svc-7')).toEqual({ moduleId: 'services', path: '/services?id=svc-7' })
    expect(resolveOperationalObjectReference('monitoring', 'check-8')).toEqual({ moduleId: 'monitoring', path: '/monitoring?id=check-8' })
    expect(resolveOperationalObjectReference('network', 19)).toEqual({ moduleId: 'network', path: '/network?id=19' })
  })

  it('normalizes audit compatibility aliases into one typed reference', () => {
    expect(createOperationalObjectReference('devices', ' 42 ')).toEqual({ objectType: 'device', objectId: '42' })
    expect(createOperationalObjectReference('asset', 42)).toEqual({ objectType: 'device', objectId: '42' })
    expect(createOperationalObjectReference('logical_services', 'svc-7')).toEqual({ objectType: 'service', objectId: 'svc-7' })
    expect(createOperationalObjectReference('services', 'svc-8')).toEqual({ objectType: 'service', objectId: 'svc-8' })
    expect(createOperationalObjectReference('monitoring_items', 'check-8')).toEqual({ objectType: 'monitoring', objectId: 'check-8' })
    expect(createOperationalObjectReference('port_connections', 19)).toEqual({ objectType: 'network', objectId: '19' })
  })

  it('URL-encodes object ids and rejects missing or unsupported targets', () => {
    expect(resolveOperationalObjectReference('device', 'rack/A 1')).toEqual({ moduleId: 'assets', path: '/asset?id=rack%2FA%201' })
    expect(resolveOperationalObjectReference('device', '')).toBeNull()
    expect(resolveOperationalObjectReference('device', null)).toBeNull()
    expect(resolveOperationalObjectReference('unknown_table', '42')).toBeNull()
    expect(resolveOperationalObjectNavigation({ objectType: 'device', objectId: '' })).toBeNull()
  })

  it('preserves historical projects, FAR, and knowledge target compatibility', () => {
    expect(resolveOperationalObjectReference('projects', 'project-1')).toEqual({ moduleId: 'projects', path: '/projects?id=project-1' })
    expect(resolveOperationalObjectReference('far', 2)).toEqual({ moduleId: 'far', path: '/far?id=2' })
    expect(resolveOperationalObjectReference('knowledge', 'article-3')).toEqual({ moduleId: 'knowledge', path: '/knowledge?id=article-3' })
  })
})
