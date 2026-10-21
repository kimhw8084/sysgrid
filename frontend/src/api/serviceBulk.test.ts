import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./apiClient', () => ({ apiClient: { post: vi.fn() }, getRequestScopeKey: vi.fn() }))
import { apiClient, getRequestScopeKey } from './apiClient'
import { createServiceBulkClient } from './serviceBulk'

const request = { action: 'update', ids: [1, 2], payload: { environment: 'Development' } }
const rowRevision = 'a'.repeat(32)
const makePreview = () => ({ action: 'update', selected_count: 2, matched_count: 2, changed_count: 1,
  unchanged_count: 1, blocked_count: 0, missing_count: 0, changed_ids: [2], unchanged_ids: [1], missing_ids: [],
  blockers: [], can_execute: true, precondition: 'b'.repeat(64), versions: { '1': rowRevision, '2': rowRevision } })
const client = () => createServiceBulkClient(() => [{ id: 1, edit_revision: rowRevision }, { id: 2, edit_revision: rowRevision }])

describe('native Service bulk adapter', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(getRequestScopeKey).mockReturnValue('actor::tenant') })

  it('binds a reviewed preview and response-loss retry to one immutable operation identity', async () => {
    const api = client(), reviewed = makePreview()
    vi.mocked(apiClient.post).mockResolvedValueOnce(reviewed).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({ receipt_id: 'c'.repeat(32), changed_ids: [2] })
    const preview = await api.previewRequest(request)
    await expect(api.executeRequest(request, preview)).rejects.toThrow('Connection lost')
    expect(apiClient.post).toHaveBeenCalledTimes(2)
    await api.executeRequest({ ...request, ids: [2, 1] }, preview)
    const first = vi.mocked(apiClient.post).mock.calls[1][1]
    const replay = vi.mocked(apiClient.post).mock.calls[2][1]
    expect(first).toMatchObject({ ...request, precondition: reviewed.precondition, operation_id: expect.stringMatching(/^[0-9a-f]{32}$/) })
    expect(replay.operation_id).toBe(first.operation_id)
    expect(replay.precondition).toBe(first.precondition)
  })

  it.each(['selection', 'action', 'payload', 'scope', 'unowned'] as const)('rejects %s mismatch before execution', async (kind) => {
    const api = client()
    vi.mocked(apiClient.post).mockResolvedValue(makePreview())
    let preview = await api.previewRequest(request)
    let changed = request
    if (kind === 'selection') changed = { ...request, ids: [1] }
    if (kind === 'action') changed = { ...request, action: 'delete' }
    if (kind === 'payload') changed = { ...request, payload: { environment: 'Staging' } }
    if (kind === 'scope') vi.mocked(getRequestScopeKey).mockReturnValue('other-actor::other-tenant')
    if (kind === 'unowned') preview = { ...preview }
    await expect(api.executeRequest(changed, preview)).rejects.toThrow('no longer matches')
    expect(apiClient.post).toHaveBeenCalledTimes(1)
  })

  it.each([null, '', 'A'.repeat(64), 1])('rejects malformed preview metadata %s', async (precondition) => {
    const api = client()
    vi.mocked(apiClient.post).mockResolvedValue({ ...makePreview(), precondition })
    await expect(api.previewRequest(request)).rejects.toThrow('preview is unavailable')
    expect(apiClient.post).toHaveBeenCalledTimes(1)
  })

  it('rejects identity-scope changes while the preview is in flight', async () => {
    const api = client()
    vi.mocked(apiClient.post).mockImplementationOnce(async () => {
      vi.mocked(getRequestScopeKey).mockReturnValue('different::scope')
      return makePreview()
    })
    await expect(api.previewRequest(request)).rejects.toThrow('preview is unavailable')
  })

  it.each(['delete', 'restore'])('guards direct row %s against the loaded revision', async (action) => {
    const api = client(), direct = { action, ids: [2], payload: {} }
    vi.mocked(apiClient.post).mockResolvedValueOnce({ ...makePreview(), action }).mockResolvedValueOnce({ changed_ids: [2] })
    await api.executeRequest(direct, null)
    expect(apiClient.post).toHaveBeenNthCalledWith(1, '/api/v1/logical-services/bulk-action', { ...direct, dry_run: true })
    expect(apiClient.post).toHaveBeenNthCalledWith(2, '/api/v1/logical-services/bulk-action', expect.objectContaining({
      ...direct, precondition: 'b'.repeat(64), operation_id: expect.stringMatching(/^[0-9a-f]{32}$/),
    }))
  })

  it('does not silently approve a newer peer revision for a direct row action', async () => {
    const api = client()
    vi.mocked(apiClient.post).mockResolvedValue({ ...makePreview(), versions: { '1': rowRevision, '2': 'c'.repeat(32) } })
    await expect(api.executeRequest({ action: 'delete', ids: [2], payload: {} }, null)).rejects.toThrow('changed since they were loaded')
    expect(apiClient.post).toHaveBeenCalledTimes(1)
  })

  it('does not write with missing loaded revisions or an unreviewed update', async () => {
    const api = createServiceBulkClient(() => [{ id: 2 }])
    await expect(api.executeRequest({ action: 'delete', ids: [2], payload: {} }, null)).rejects.toThrow('data is unavailable')
    await expect(api.executeRequest(request, null)).rejects.toThrow('Review a fresh')
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('builds exact changed-only compensation from a server receipt and never from snapshots', async () => {
    const api = client()
    const context: any = { changedIds: [2], previousSnapshots: [{ id: 1 }, { id: 2 }], changedSnapshots: [{ id: 2 }],
      result: { can_revert: true, receipt_id: 'd'.repeat(32) } }
    const compensation = api.buildRevertRequest(context)!
    expect(compensation).toEqual({ action: 'undo', ids: [2], payload: { receipt_id: 'd'.repeat(32) } })
    vi.mocked(apiClient.post).mockResolvedValue({ status: 'reverted' })
    await api.executeRequest(compensation)
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/logical-services/bulk-action', {
      action: 'undo', ids: [2], receipt_id: 'd'.repeat(32),
    })
    for (const result of [{ can_revert: false, receipt_id: 'd'.repeat(32) }, { can_revert: true }, { can_revert: true, receipt_id: 'invalid' }]) {
      expect(api.buildRevertRequest({ ...context, result })).toBeNull()
    }
    expect(api.buildRevertRequest({ ...context, changedIds: [] })).toBeNull()
  })

  it('preserves distinct Undo receipt identities after newer operations', async () => {
    const api = client()
    vi.mocked(apiClient.post).mockResolvedValue({ status: 'reverted' })
    const a = api.buildRevertRequest({ result: { can_revert: true, receipt_id: 'a'.repeat(32) }, changedIds: [1] } as any)!
    const b = api.buildRevertRequest({ result: { can_revert: true, receipt_id: 'b'.repeat(32) }, changedIds: [2] } as any)!
    await api.executeRequest(a)
    await api.executeRequest(b)
    expect(vi.mocked(apiClient.post).mock.calls.map((call) => call[1])).toEqual([
      { action: 'undo', ids: [1], receipt_id: 'a'.repeat(32) }, { action: 'undo', ids: [2], receipt_id: 'b'.repeat(32) },
    ])
  })
})
