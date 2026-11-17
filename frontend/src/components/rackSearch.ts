export interface RackSearchMatch<T> {
  rack: T
  matchedDeviceIds: string[]
}

const normalized = (value: unknown) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

const searchableValues = (record: any) => [
  record?.id,
  record?.name,
  record?.site_name,
  record?.aisle,
  record?.row,
  record?.system,
  record?.owner,
  record?.business_unit,
  record?.manufacturer,
  record?.model,
  record?.serial_number,
  record?.asset_tag,
  record?.type,
  record?.status,
  record?.management_ip,
  record?.temporary_name,
  record?.reservation_info?.poc,
].filter(value => value !== null && value !== undefined).map(normalized)

/** Search racks and only the devices mounted in each rack. The supplemental
 * device collection is joined by the API-provided device id; unrelated devices
 * are never allowed to make a rack match. */
export function searchRackCollection<T extends { id?: number | string; device_locations?: any[] }>(
  racks: T[],
  query: string,
  devices: any[] = [],
): RackSearchMatch<T>[] {
  const tokens = normalized(query).trim().split(/\s+/).filter(Boolean)
  const devicesById = new Map(devices.map(device => [String(device?.id), device]))

  return racks.flatMap(rack => {
    const locations = Array.isArray(rack.device_locations) ? rack.device_locations : []
    const mountedAssets = locations.map(location => {
      const id = location?.device_id ?? location?.device?.id
      const linkedRecord = devicesById.get(String(id)) || {}
      const embeddedRecord = location?.device || {}
      const record = { ...linkedRecord, ...embeddedRecord }
      for (const field of ['id', 'name', 'system', 'owner', 'business_unit', 'manufacturer', 'model', 'serial_number', 'asset_tag', 'type', 'status', 'management_ip']) {
        if (record[field] == null && linkedRecord[field] != null) record[field] = linkedRecord[field]
      }
      return {
        id,
        record,
        location,
      }
    })
    const rackText = searchableValues(rack).join(' ')
    const assetTexts = mountedAssets.map(({ record, location }) => [
      ...searchableValues(record),
      ...searchableValues(location),
    ].join(' '))

    if (tokens.length && !tokens.every(token =>
      rackText.includes(token) || assetTexts.some(text => text.includes(token)))) {
      return []
    }

    const matchedDeviceIds = tokens.length
      ? mountedAssets.flatMap(({ id, record, location }) => {
        const assetText = [...searchableValues(record), ...searchableValues(location)].join(' ')
        const idText = normalized(id)
        const matched = tokens.some(token => assetText.includes(token))
          || tokens.some(token => idText.includes(token))
        return matched && id !== undefined && id !== null ? [String(id)] : []
      })
      : []

    return [{ rack, matchedDeviceIds: [...new Set(matchedDeviceIds)] }]
  })
}
