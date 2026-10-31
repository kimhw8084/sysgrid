export type RackUnitStatusKey = 'empty' | 'active' | 'maintenance' | 'retired' | 'offline' | 'standby' | 'reserved' | 'unknown'

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
