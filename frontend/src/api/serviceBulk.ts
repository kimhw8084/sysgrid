import { apiClient, getRequestScopeKey } from './apiClient'
import type { OperationalBulkPreview } from '../components/shared/OperationalBulkPreviewModal'
import type {
  OperationalBulkExecutionResult, OperationalBulkRequest, OperationalBulkRevertContext,
} from '../components/shared/useOperationalBulkWorkflow'

const PATH = '/api/v1/logical-services/bulk-action'
type ServiceRow = { id: number; edit_revision?: string }
type ServicePreview = OperationalBulkPreview & { precondition: string; versions: Record<string, string> }
const token = (value: unknown, length: number): value is string => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value)

export function createServiceTableEditClient() {
  const scope = getRequestScopeKey()
  let pending: { binding: string; operationId: string } | null = null
  return async (rows: Array<{ id: number; expected_revision: string; changes: Record<string, unknown> }>) => {
    if (scope !== getRequestScopeKey()) throw new Error('The Service draft belongs to a different session. Close and reopen the table.')
    if (rows.some(row => !token(row.expected_revision, 32))) throw new Error('Service revisions are unavailable. Close and reopen the table.')
    const binding = JSON.stringify(rows.map(row => ({ ...row,
      changes: Object.fromEntries(Object.entries(row.changes).sort(([a], [b]) => a.localeCompare(b))),
    })).sort((a, b) => a.id - b.id))
    if (!pending || pending.binding !== binding) pending = { binding, operationId: crypto.randomUUID().replace(/-/g, '') }
    return apiClient.post('/api/v1/logical-services/table-edit', { rows, operation_id: pending.operationId }) as Promise<OperationalBulkExecutionResult>
  }
}

export function createServiceBulkClient(getRows: () => readonly ServiceRow[]) {
  const previews = new WeakMap<OperationalBulkPreview, { operationId: string; scope: string; binding: string }>()
  const binding = ({ action, ids, payload }: OperationalBulkRequest) => JSON.stringify({
    action, ids: [...ids].sort((a, b) => a - b),
    payload: Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))),
  })
  const previewRequest = async (request: OperationalBulkRequest): Promise<ServicePreview> => {
    const scope = getRequestScopeKey()
    const result = await apiClient.post(PATH, { ...request, dry_run: true }) as ServicePreview
    if (getRequestScopeKey() !== scope || !token(result?.precondition, 64)
      || !result.versions || typeof result.versions !== 'object' || Array.isArray(result.versions)
      || Object.values(result.versions).some((revision) => !token(revision, 32))) {
      throw new Error('The Service preview is unavailable. Review a fresh preview before applying changes.')
    }
    previews.set(result, { operationId: crypto.randomUUID().replace(/-/g, ''), scope, binding: binding(request) })
    return result
  }
  const executeRequest = async (request: OperationalBulkRequest, reviewed?: OperationalBulkPreview | null): Promise<OperationalBulkExecutionResult> => {
    if (request.action === 'undo') {
      if (!token(request.payload.receipt_id, 32)) throw new Error('The original Service receipt is unavailable. Nothing was reverted.')
      return apiClient.post(PATH, { action: 'undo', ids: request.ids, receipt_id: request.payload.receipt_id })
    }
    if (!['update', 'delete', 'restore'].includes(request.action)) throw new Error('Unsupported Service bulk action.')
    let preview = reviewed as ServicePreview | null | undefined
    if (!preview) {
      // Single-row archive/restore already has an explicit row confirmation.
      // Bind that loaded row to a fresh backend preview without silently
      // adopting a peer revision that the operator has never seen.
      if (!['delete', 'restore'].includes(request.action)) throw new Error('Review a fresh Service preview before applying changes.')
      const versions = new Map(getRows().map((row) => [row.id, row.edit_revision]))
      if (request.ids.some((id) => !token(versions.get(id), 32))) throw new Error('Service data is unavailable. Refresh and review the selection.')
      preview = await previewRequest(request)
      if (request.ids.some((id) => preview!.versions[String(id)] !== versions.get(id))) {
        throw new Error('Services changed since they were loaded. Nothing was changed; refresh and review the selection.')
      }
    }
    const owned = previews.get(preview)
    if (!owned || owned.scope !== getRequestScopeKey() || owned.binding !== binding(request)) {
      throw new Error('The Service preview no longer matches this selection. Review a fresh preview.')
    }
    return apiClient.post(PATH, { ...request, precondition: preview.precondition, operation_id: owned.operationId })
  }
  const buildRevertRequest = ({ result, changedIds }: OperationalBulkRevertContext<ServiceRow>) => (
    result.can_revert === true && token(result.receipt_id, 32) && changedIds.length > 0
      ? { action: 'undo', ids: changedIds, payload: { receipt_id: result.receipt_id } } : null
  )
  return { previewRequest, executeRequest, buildRevertRequest }
}
