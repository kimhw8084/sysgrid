const comparableId = (value: unknown) => {
  if (value == null || String(value).trim() === '') return ''
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) ? String(numeric) : String(value).trim()
}

export function orientAssetNetworkConnection(deviceId: number | string, link: Record<string, any>) {
  const isSource = comparableId(link?.source_device_id) === comparableId(deviceId)
  const isTarget = comparableId(link?.target_device_id) === comparableId(deviceId)
  return {
    isSource,
    isTarget,
    peerName: isSource ? link?.target_device_name : link?.source_device_name,
    localPort: isSource ? link?.source_port : link?.target_port,
    peerPort: isSource ? link?.target_port : link?.source_port,
  }
}
