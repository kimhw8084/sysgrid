import { apiFetch } from '../../api/apiClient'

export async function fetchOperationalArray(endpoint: string, label: string, options: { silent?: boolean } = {}): Promise<any[]> {
  try {
    const response = await apiFetch(endpoint)
    if (response.ok === false) {
      throw Object.assign(new Error(`${label} failed with status ${response.status}.`), {
        status: response.status,
      })
    }
    const records = await response.json()
    if (!Array.isArray(records)) {
      throw new Error(`${label} returned an invalid list response.`)
    }
    return records
  } catch (error) {
    if (options.silent && error instanceof Error) Object.assign(error, { silent: true })
    throw error
  }
}
