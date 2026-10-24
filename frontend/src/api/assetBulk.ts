import { apiClient, getRequestScopeKey } from './apiClient'
import type { OperationalBulkPreview } from '../components/shared/OperationalBulkPreviewModal'
import type {
  OperationalBulkExecutionResult, OperationalBulkRequest, OperationalBulkRevertContext,
} from '../components/shared/useOperationalBulkWorkflow'

const PATH = '/api/v1/devices/bulk-action'
type AssetRow = { id: number; edit_revision?: string }
type AssetPreview = OperationalBulkPreview & { precondition: string; versions: Record<string, string> }
const token = (value: unknown, length: number): value is string => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value)

export function createAssetBulkClient(getRows: () => readonly AssetRow[]) {
  const previews = new WeakMap<OperationalBulkPreview, { operationId: string; scope: string; binding: string }>()
  const binding = ({ action, ids, payload }: OperationalBulkRequest) => JSON.stringify({
    action, ids: [...ids].sort((a, b) => a - b),
    payload: Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))),
  })
  const previewRequest = async (request: OperationalBulkRequest): Promise<AssetPreview> => {
    const scope = getRequestScopeKey()
    const result = await apiClient.post(PATH, { ...request, dry_run: true }) as AssetPreview
    if (getRequestScopeKey() !== scope || !token(result?.precondition, 64)
      || !result.versions || typeof result.versions !== 'object' || Array.isArray(result.versions)
      || Object.values(result.versions).some((revision) => !token(revision, 32))) {
      throw new Error('The Asset preview is unavailable. Review a fresh preview before applying changes.')
    }
    previews.set(result, { operationId: crypto.randomUUID().replace(/-/g, ''), scope, binding: binding(request) })
    return result
  }
  const executeRequest = async (request: OperationalBulkRequest, reviewed?: OperationalBulkPreview | null): Promise<OperationalBulkExecutionResult> => {
    if (request.action === 'undo') {
      if (!token(request.payload.receipt_id, 32)) throw new Error('The original Asset receipt is unavailable. Nothing was reverted.')
      return apiClient.post(PATH, { action: 'undo', ids: request.ids, receipt_id: request.payload.receipt_id })
    }
    if (!['update', 'delete', 'restore', 'purge'].includes(request.action)) throw new Error('Unsupported Asset bulk action.')
    let preview = reviewed as AssetPreview | null | undefined
    if (!preview) {
      // Single-row archive/restore already has an explicit row confirmation.
      // Bind that loaded row to a fresh backend preview without silently
      // adopting a peer revision that the operator has never seen.
      if (!['delete', 'restore'].includes(request.action)) throw new Error('Review a fresh Asset preview before applying changes.')
      const versions = new Map(getRows().map((row) => [row.id, row.edit_revision]))
      if (request.ids.some((id) => !token(versions.get(id), 32))) throw new Error('Asset data is unavailable. Refresh and review the selection.')
      preview = await previewRequest(request)
      if (request.ids.some((id) => preview!.versions[String(id)] !== versions.get(id))) {
        throw new Error('Assets changed since they were loaded. Nothing was changed; refresh and review the selection.')
      }
    }
    const owned = previews.get(preview)
    if (!owned || owned.scope !== getRequestScopeKey() || owned.binding !== binding(request)) {
      throw new Error('The Asset preview no longer matches this selection. Review a fresh preview.')
    }
    return apiClient.post(PATH, { ...request, precondition: preview.precondition, operation_id: owned.operationId })
  }
  const buildRevertRequest = ({ result, changedIds }: OperationalBulkRevertContext<AssetRow>) => (
    result.can_revert === true && token(result.receipt_id, 32) && changedIds.length > 0
      ? { action: 'undo', ids: changedIds, payload: { receipt_id: result.receipt_id } } : null
  )
  return { previewRequest, executeRequest, buildRevertRequest }
}
