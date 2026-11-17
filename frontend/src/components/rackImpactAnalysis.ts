type RackImpactDevice = Record<string, any>
type RackImpactConnection = Record<string, any>

const normalizeId = (value: unknown) => {
  if (value == null || String(value).trim() === '') return ''
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) ? String(numeric) : String(value).trim()
}

const displayValue = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
  return text || 'Unknown'
}

const increment = (counts: Record<string, number>, value: unknown) => {
  const label = displayValue(value)
  counts[label] = (counts[label] || 0) + 1
}

export function buildRackImpactAnalysis(
  deviceId: number | string,
  devices: RackImpactDevice[],
  allConnections: RackImpactConnection[],
) {
  const currentId = normalizeId(deviceId)
  const devicesById = new Map(
    devices.filter((device) => normalizeId(device?.id)).map((device) => [normalizeId(device.id), device]),
  )
  const device = devicesById.get(currentId) ?? null
  const connections = allConnections.filter((connection) => (
    normalizeId(connection?.source_device_id) === currentId || normalizeId(connection?.target_device_id) === currentId
  ))
  const distribution: Record<string, Record<string, number>> = {
    type: Object.create(null),
    status: Object.create(null),
    environment: Object.create(null),
    system: Object.create(null),
  }
  const peers = connections.map((connection) => {
    const isSource = normalizeId(connection?.source_device_id) === currentId
    const peerId = isSource ? connection?.target_device_id : connection?.source_device_id
    const peer = devicesById.get(normalizeId(peerId)) ?? null
    increment(distribution.type, peer?.type)
    increment(distribution.status, peer?.status)
    increment(distribution.environment, peer?.environment)
    increment(distribution.system, peer?.system)
    return {
      connection,
      peer,
      peerId,
      localPort: isSource ? connection?.source_port : connection?.target_port,
      peerPort: isSource ? connection?.target_port : connection?.source_port,
    }
  })

  const knownSystems = new Set(peers.flatMap(({ peer }) => {
    const system = typeof peer?.system === 'string' ? peer.system.trim() : ''
    return system ? [system.toLocaleLowerCase()] : []
  }))
  const peerIds = new Set(peers.map(({ peerId }) => normalizeId(peerId)).filter(Boolean))

  return {
    device,
    connections,
    peers,
    distribution,
    peerCount: peerIds.size,
    connectedSystemCount: knownSystems.size,
  }
}
