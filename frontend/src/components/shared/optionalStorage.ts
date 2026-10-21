import { showWorkspaceToast } from './WorkspaceToast'

type StorageArea = 'localStorage' | 'sessionStorage'
let noticeScheduled = false

function isStorageUnavailable(error: unknown): boolean {
  return error instanceof DOMException && (
    error.name === 'SecurityError' || error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  )
}

function storageOperation<T>(area: StorageArea, operation: (storage: Storage) => T, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    return operation(window[area])
  } catch (error) {
    if (!isStorageUnavailable(error)) throw error
    return fallback
  }
}

// Only optional preferences/caches belong here. Identity, tenant selection and
// unsaved primary data must retain their own failure handling.
export function readOptionalStorage(key: string, area: StorageArea = 'localStorage'): string | null {
  return storageOperation(area, storage => storage.getItem(key), null)
}

function persistOptionalStorage(area: StorageArea, operation: (storage: Storage) => void): boolean {
  const saved = storageOperation(area, storage => { operation(storage); return true }, false)
  if (!saved && typeof window !== 'undefined' && !noticeScheduled) {
    noticeScheduled = true
    // Session initialization can happen during render. Notify after it settles,
    // once per application lifetime rather than on every grid preference event.
    queueMicrotask(() => showWorkspaceToast('Browser storage is unavailable. Local preferences may be lost when you reload.', {
      id: 'workspace-storage-unavailable', type: 'error',
    }))
  }
  return saved
}

export function writeOptionalStorage(key: string, value: string, area: StorageArea = 'localStorage'): boolean {
  return persistOptionalStorage(area, storage => storage.setItem(key, value))
}

export function removeOptionalStorage(key: string, area: StorageArea = 'localStorage'): boolean {
  return persistOptionalStorage(area, storage => storage.removeItem(key))
}
