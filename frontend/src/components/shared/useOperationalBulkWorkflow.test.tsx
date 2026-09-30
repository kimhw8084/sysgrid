import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./OperationalBulkContract', () => ({
  resolveBulkFieldLabel: (payload: Record<string, any>, labels: Record<string, string>) => {
    const key = Object.keys(payload)[0]
    return labels[key] || key || 'Field'
  },
  showOperationalBulkErrorToast: vi.fn(),
  showOperationalBulkResultToast: vi.fn(),
  showOperationalBulkRevertedToast: vi.fn(),
  showOperationalBulkRevertErrorToast: vi.fn(),
}))

import {
  showOperationalBulkErrorToast,
  showOperationalBulkResultToast,
  showOperationalBulkRevertedToast,
  showOperationalBulkRevertErrorToast,
} from './OperationalBulkContract'
import { useOperationalBulkWorkflow } from './useOperationalBulkWorkflow'

const preview = {
  action: 'update',
  selected_count: 2,
  matched_count: 2,
  changed_count: 1,
  unchanged_count: 1,
  blocked_count: 0,
  missing_count: 0,
  changed_ids: [2],
  unchanged_ids: [1],
  missing_ids: [],
  blockers: [],
  can_execute: true,
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const renderWorkflow = (overrides: Record<string, any> = {}) => {
  const previewRequest = overrides.previewRequest || vi.fn().mockResolvedValue(preview)
  const executeRequest = overrides.executeRequest || vi.fn().mockResolvedValue({
    changed_count: 1,
    unchanged_count: 1,
    changed_ids: [2],
  })
  const refresh = overrides.refresh || vi.fn().mockResolvedValue(undefined)
  const buildRevertRequest = overrides.buildRevertRequest || vi.fn().mockReturnValue({
    action: 'update',
    ids: [2],
    payload: { country: 'South Korea' },
  })

  const hook = renderHook(() => useOperationalBulkWorkflow({
    selectedIds: [2, 2, 1],
    fieldLabels: { country: 'Country' },
    selectionErrorMessage: 'Select at least one vendor',
    previewErrorMessage: 'Vendor preview failed',
    executionErrorMessage: 'Vendor operation failed',
    revertErrorMessage: 'Vendor bulk undo failed',
    getSnapshots: () => [
      { id: 1, country: 'South Korea' },
      { id: 2, country: 'South Korea' },
    ],
    previewRequest,
    executeRequest,
    refresh,
    buildRevertRequest,
    ...overrides,
  }), { wrapper: createWrapper() })

  return { ...hook, previewRequest, executeRequest, refresh, buildRevertRequest }
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

const prepareReceipt = async (workflow: ReturnType<typeof renderWorkflow>) => {
  act(() => workflow.result.current.requestBulkPreview({ action: 'update', payload: { country: 'USA' } }))
  await waitFor(() => expect(workflow.result.current.bulkOperationPreview).not.toBeNull())
  await act(async () => {
    await workflow.result.current.bulkMutation.mutateAsync({ action: 'update', payload: { country: 'USA' } })
  })
  await waitFor(() => expect(workflow.result.current.bulkOperationPreview?.result?.can_revert).toBe(true))
  return vi.mocked(showOperationalBulkResultToast).mock.calls.at(-1)![0].onRevert!
}

describe('useOperationalBulkWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes one selected identity set and creates the shared preview envelope', async () => {
    const onPreviewAccepted = vi.fn()
    const { result, previewRequest } = renderWorkflow({ onPreviewAccepted })

    act(() => {
      result.current.requestBulkPreview({ action: 'update', payload: { country: 'USA' } })
    })

    await waitFor(() => expect(previewRequest).toHaveBeenCalledWith({
      action: 'update',
      ids: [2, 1],
      payload: { country: 'USA' },
    }))
    await waitFor(() => expect(result.current.bulkOperationPreview?.actionLabel).toBe('Apply Country'))

    expect(result.current.bulkOperationPreview).toMatchObject({
      action: 'update',
      ids: [2, 1],
      fieldLabel: 'Country',
      nextValue: 'USA',
      preview,
    })
    expect(onPreviewAccepted).toHaveBeenCalledTimes(1)
  })

  it('executes after preview, publishes an exact receipt, and reverts only backend-confirmed changed IDs', async () => {
    const executeRequest = vi.fn()
      .mockResolvedValueOnce({ changed_count: 1, unchanged_count: 1, changed_ids: [2] })
      .mockResolvedValueOnce({ changed_count: 1, unchanged_count: 0, changed_ids: [2] })
    const onExecutionSuccess = vi.fn()
    const onRevertSuccess = vi.fn()
    const { result, refresh, buildRevertRequest } = renderWorkflow({
      executeRequest,
      onExecutionSuccess,
      onRevertSuccess,
    })

    act(() => {
      result.current.requestBulkPreview({ action: 'update', payload: { country: 'USA' } })
    })
    await waitFor(() => expect(result.current.bulkOperationPreview).not.toBeNull())

    act(() => {
      result.current.bulkMutation.mutate({ action: 'update', ids: [1, 2], payload: { country: 'USA' } })
    })

    await waitFor(() => expect(result.current.bulkOperationPreview?.result).toEqual({
      selected_count: 2,
      changed_count: 1,
      unchanged_count: 1,
      can_revert: true,
    }))

    expect(buildRevertRequest).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update',
      ids: [1, 2],
      changedIds: [2],
      changedSnapshots: [{ id: 2, country: 'South Korea' }],
    }))
    expect(onExecutionSuccess).toHaveBeenCalledWith(expect.objectContaining({ changedIds: [2] }))
    expect(showOperationalBulkResultToast).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update',
      totalSelected: 2,
      changedCount: 1,
      unchangedCount: 1,
      fieldLabel: 'Country',
      onRevert: expect.any(Function),
    }))

    await act(async () => {
      await result.current.runBulkReceiptRevert()
    })

    expect(executeRequest).toHaveBeenNthCalledWith(2, {
      action: 'update',
      ids: [2],
      payload: { country: 'South Korea' },
    })
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(onRevertSuccess).toHaveBeenCalledWith(expect.objectContaining({ changedIds: [2] }))
    expect(showOperationalBulkRevertedToast).toHaveBeenCalledTimes(1)
    expect(result.current.bulkOperationPreview).toBeNull()
  })

  it('carries the execution-start generation into the matching successful result', async () => {
    const onExecutionStart = vi.fn((_ids: number[], action?: string) => ({
      action,
      recoveryGeneration: 7,
    }))
    const onExecutionSuccess = vi.fn()
    const { result } = renderWorkflow({ onExecutionStart, onExecutionSuccess })

    act(() => {
      result.current.bulkMutation.mutate({ action: 'purge', ids: [2] })
    })

    await waitFor(() => expect(onExecutionSuccess).toHaveBeenCalledTimes(1))
    expect(onExecutionStart).toHaveBeenCalledWith([2], 'purge')
    expect(onExecutionSuccess).toHaveBeenCalledWith(expect.objectContaining({
      action: 'purge',
      executionStartContext: { action: 'purge', recoveryGeneration: 7 },
    }))
  })

  it('fails closed on contradictory changed-record identity and does not advertise undo', async () => {
    const buildRevertRequest = vi.fn()
    const { result } = renderWorkflow({
      executeRequest: vi.fn().mockResolvedValue({
        changed_count: 1,
        unchanged_count: 1,
        changed_ids: [99],
      }),
      buildRevertRequest,
    })

    act(() => {
      result.current.requestBulkPreview({ action: 'delete', ids: [1, 2] })
    })
    await waitFor(() => expect(result.current.bulkOperationPreview).not.toBeNull())

    act(() => {
      result.current.bulkMutation.mutate({ action: 'delete', ids: [1, 2] })
    })

    await waitFor(() => expect(result.current.bulkOperationPreview?.result?.can_revert).toBe(false))
    expect(buildRevertRequest).not.toHaveBeenCalled()
    expect(showOperationalBulkResultToast).toHaveBeenCalledWith(expect.objectContaining({ onRevert: undefined }))
  })

  it('keeps purge irreversible even when an adapter could construct a reverse request', async () => {
    const buildRevertRequest = vi.fn().mockReturnValue({ action: 'restore', ids: [2] })
    const { result } = renderWorkflow({ buildRevertRequest })

    act(() => {
      result.current.requestBulkPreview({ action: 'purge', ids: [1, 2] })
    })
    await waitFor(() => expect(result.current.bulkOperationPreview).not.toBeNull())

    act(() => {
      result.current.bulkMutation.mutate({ action: 'purge', ids: [1, 2] })
    })

    await waitFor(() => expect(result.current.bulkOperationPreview?.result?.can_revert).toBe(false))
    expect(buildRevertRequest).not.toHaveBeenCalled()
  })

  it('rejects an empty selection before either endpoint is called', async () => {
    const previewRequest = vi.fn()
    const { result } = renderWorkflow({ selectedIds: [], previewRequest })

    act(() => {
      result.current.requestBulkPreview({ action: 'delete' })
    })

    await waitFor(() => expect(showOperationalBulkErrorToast).toHaveBeenCalledWith('Select at least one vendor'))
    expect(previewRequest).not.toHaveBeenCalled()
  })

  it('retains the newest preview when an older request completes last', async () => {
    const oldRequest = deferred<typeof preview>()
    const onPreviewAccepted = vi.fn()
    const previewRequest = vi.fn().mockReturnValueOnce(oldRequest.promise).mockResolvedValue(preview)
    const { result } = renderWorkflow({ previewRequest, onPreviewAccepted })

    act(() => result.current.requestBulkPreview({ action: 'update', payload: { country: 'USA' } }))
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(1))
    act(() => result.current.requestBulkPreview({ action: 'delete', ids: [1] }))
    await waitFor(() => expect(result.current.bulkOperationPreview?.action).toBe('delete'))
    await act(async () => oldRequest.resolve(preview))

    expect(result.current.bulkOperationPreview).toMatchObject({ action: 'delete', ids: [1] })
    expect(onPreviewAccepted).toHaveBeenCalledTimes(1)
  })

  it('ignores an obsolete preview error after a newer preview succeeds', async () => {
    const oldRequest = deferred<typeof preview>()
    const previewRequest = vi.fn().mockReturnValueOnce(oldRequest.promise).mockResolvedValue(preview)
    const { result } = renderWorkflow({ previewRequest })

    act(() => result.current.requestBulkPreview({ action: 'delete' }))
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(1))
    act(() => result.current.requestBulkPreview({ action: 'restore' }))
    await waitFor(() => expect(result.current.bulkOperationPreview?.action).toBe('restore'))
    await act(async () => oldRequest.reject(new Error('Obsolete preview failed')))

    expect(showOperationalBulkErrorToast).not.toHaveBeenCalled()
    expect(result.current.bulkOperationPreview?.action).toBe('restore')
  })

  it.each(['pending', 'same event'] as const)('does not reopen a dismissed %s preview', async (timing) => {
    const request = deferred<typeof preview>()
    const previewRequest = vi.fn().mockReturnValue(request.promise)
    const onPreviewAccepted = vi.fn()
    const { result } = renderWorkflow({ previewRequest, onPreviewAccepted })

    act(() => {
      result.current.requestBulkPreview({ action: 'delete' })
      if (timing === 'same event') result.current.setBulkOperationPreview(null)
    })
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(1))
    if (timing === 'pending') act(() => result.current.setBulkOperationPreview(null))
    await act(async () => request.resolve(preview))

    expect(result.current.bulkOperationPreview).toBeNull()
    expect(onPreviewAccepted).not.toHaveBeenCalled()
  })

  it('does not accept a preview after its workspace unmounts', async () => {
    const request = deferred<typeof preview>()
    const previewRequest = vi.fn().mockReturnValue(request.promise)
    const onPreviewAccepted = vi.fn()
    const { result, unmount } = renderWorkflow({ previewRequest, onPreviewAccepted })

    act(() => result.current.requestBulkPreview({ action: 'delete' }))
    await waitFor(() => expect(previewRequest).toHaveBeenCalledTimes(1))
    unmount()
    await act(async () => request.resolve(preview))

    expect(onPreviewAccepted).not.toHaveBeenCalled()
  })

  it('keeps a completed operation receipt out of a newer preview', async () => {
    const execution = deferred<{ changed_count: number; changed_ids: number[] }>()
    const executeRequest = vi.fn().mockReturnValue(execution.promise)
    const { result, refresh } = renderWorkflow({ executeRequest })
    act(() => result.current.requestBulkPreview({ action: 'delete', ids: [2] }))
    await waitFor(() => expect(result.current.bulkOperationPreview?.action).toBe('delete'))
    act(() => result.current.bulkMutation.mutate({ action: 'delete', ids: [2] }))
    await waitFor(() => expect(executeRequest).toHaveBeenCalledTimes(1))
    act(() => result.current.requestBulkPreview({ action: 'update', ids: [1], payload: { country: 'Canada' } }))
    await waitFor(() => expect(result.current.bulkOperationPreview?.nextValue).toBe('Canada'))
    await act(async () => execution.resolve({ changed_count: 1, changed_ids: [2] }))
    await waitFor(() => expect(showOperationalBulkResultToast).toHaveBeenCalledTimes(1))

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(result.current.bulkOperationPreview?.result).toBeUndefined()
    expect(result.current.bulkOperationPreview?.onRevert).toBeUndefined()
    expect(result.current.bulkOperationPreview?.ids).toEqual([1])
  })

  it('keeps a newer preview open when an earlier toast undo completes', async () => {
    const workflow = renderWorkflow()
    const undo = await prepareReceipt(workflow)
    act(() => workflow.result.current.requestBulkPreview({ action: 'delete', ids: [1] }))
    await waitFor(() => expect(workflow.result.current.bulkOperationPreview?.action).toBe('delete'))

    await act(async () => { await undo() })

    expect(workflow.result.current.bulkOperationPreview).toMatchObject({ action: 'delete', ids: [1] })
    expect(workflow.executeRequest).toHaveBeenCalledTimes(2)
  })

  it('does not attach a direct row action receipt to an unrelated open preview', async () => {
    const { result } = renderWorkflow()
    act(() => result.current.requestBulkPreview({ action: 'update', payload: { country: 'USA' } }))
    await waitFor(() => expect(result.current.bulkOperationPreview?.action).toBe('update'))
    await act(async () => {
      await result.current.bulkMutation.mutateAsync({ action: 'delete', ids: [2] })
    })

    expect(result.current.bulkOperationPreview?.result).toBeUndefined()
    expect(result.current.bulkOperationPreview?.onRevert).toBeUndefined()
    expect(showOperationalBulkResultToast).toHaveBeenCalledTimes(1)
  })

  it('shares one undo request between the receipt and toast and prevents replay after success', async () => {
    const request = deferred<{ changed_count: number; changed_ids: number[] }>()
    const executeRequest = vi.fn()
      .mockResolvedValueOnce({ changed_count: 1, unchanged_count: 1, changed_ids: [2] })
      .mockReturnValue(request.promise)
    const workflow = renderWorkflow({ executeRequest })
    const undo = await prepareReceipt(workflow)
    let receiptUndo!: Promise<void>
    let toastUndo!: Promise<void>
    act(() => {
      receiptUndo = workflow.result.current.runBulkReceiptRevert()
      toastUndo = Promise.resolve(undo())
    })
    const requestCountWhilePending = executeRequest.mock.calls.length
    expect(workflow.result.current.isBulkReverting).toBe(true)
    await act(async () => {
      request.resolve({ changed_count: 1, changed_ids: [2] })
      await Promise.all([receiptUndo, toastUndo])
    })
    await act(async () => { await undo() })

    expect(requestCountWhilePending).toBe(2)
    expect(executeRequest).toHaveBeenCalledTimes(2)
    expect(showOperationalBulkRevertedToast).toHaveBeenCalledTimes(1)
    expect(workflow.result.current.isBulkReverting).toBe(false)
  })

  it('allows retry when the undo request failed and keeps its receipt available', async () => {
    const executeRequest = vi.fn()
      .mockResolvedValueOnce({ changed_count: 1, changed_ids: [2] })
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce({ changed_count: 1, changed_ids: [2] })
    const workflow = renderWorkflow({ executeRequest })
    const undo = await prepareReceipt(workflow)

    await act(async () => { await expect(undo()).rejects.toThrow('Connection lost') })
    expect(workflow.result.current.bulkOperationPreview?.onRevert).toBe(undo)
    expect(showOperationalBulkRevertErrorToast).toHaveBeenCalledTimes(1)
    await act(async () => { await undo() })

    expect(executeRequest).toHaveBeenCalledTimes(3)
    expect(workflow.result.current.bulkOperationPreview).toBeNull()
    expect(showOperationalBulkRevertedToast).toHaveBeenCalledTimes(1)
  })

  it('retries a failed refresh after undo without repeating the successful server write', async () => {
    const refresh = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Refresh failed'))
      .mockResolvedValueOnce(undefined)
    const workflow = renderWorkflow({ refresh })
    const undo = await prepareReceipt(workflow)

    await act(async () => { await expect(undo()).rejects.toThrow('Refresh failed') })
    await act(async () => { await undo() })

    expect(workflow.executeRequest).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(workflow.result.current.bulkOperationPreview).toBeNull()
    expect(showOperationalBulkRevertedToast).toHaveBeenCalledTimes(1)
  })
})
