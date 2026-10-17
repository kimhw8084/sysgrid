const CACHE_PREFIX = 'SYSGRID_CONFIG_'
const DISCOVERY_KEYS = new Set(['API_ENDPOINT', 'PORT', 'DEFAULT_USER_ID'])

// Bootstrap owns this cache. Privileged Settings responses must never write
// their private parameters or diagnostic metadata into browser persistence.
export function replaceBootstrapConfigurationCache(config: unknown, storage: Storage = localStorage): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid public configuration response')
  }
  const next = new Map<string, string>()
  for (const [key, value] of Object.entries(config)) {
    if (!key.startsWith('VITE_') && !DISCOVERY_KEYS.has(key)) continue
    if (value === null) continue
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error('Invalid public configuration response')
    }
    next.set(CACHE_PREFIX + key, String(value))
  }

  // Validate the complete public snapshot before mutating storage. Remove
  // obsolete keys as well as private values cached by older application builds.
  const previousKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
  let changed = false
  for (const key of previousKeys) {
    if (key?.startsWith(CACHE_PREFIX) && !next.has(key)) {
      storage.removeItem(key)
      changed = true
    }
  }
  for (const [key, value] of next) {
    if (storage.getItem(key) !== value) {
      storage.setItem(key, value)
      changed = true
    }
  }
  return changed
}
