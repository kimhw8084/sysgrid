export type RackUnitStatusKey = 'empty' | 'active' | 'maintenance' | 'retired' | 'offline' | 'standby' | 'reserved' | 'unknown'
export type RackDeviceTypeTone = 'physical' | 'virtual' | 'storage' | 'switch' | 'server' | 'unknown'

export const getRackDeviceTypeTone = (value: unknown): RackDeviceTypeTone => {
  const type = String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (type === 'virtual' || /\b(virtual|vm|hypervisor)\b/.test(type)) return 'virtual'
  if (type === 'storage' || /\b(storage|san|nas|disk|array)\b/.test(type)) return 'storage'
  if (type === 'switch' || /\b(switch|router|network|firewall|fabric)\b/.test(type)) return 'switch'
  if (type === 'server' || /\b(server|compute|node|host|blade)\b/.test(type)) return 'server'
  if (type === 'physical' || /\b(physical|hardware|appliance)\b/.test(type)) return 'physical'
  return 'unknown'
}

export const getRackUnitStatusKey = (device: any): RackUnitStatusKey => {
  if (!device) return 'empty'
  if (device.is_reservation) return 'reserved'
  const status = String(device.status || '').trim().toLowerCase()
  if (status === 'maintenance') return 'maintenance'
  if (status === 'decommissioned' || status === 'deleted') return 'retired'
  if (status === 'offline') return 'offline'
  if (status === 'standby') return 'standby'
  if (status === 'active') return 'active'
  return 'unknown'
}
