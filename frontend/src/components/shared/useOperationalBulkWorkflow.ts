import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  resolveBulkFieldLabel,
  showOperationalBulkErrorToast,
  showOperationalBulkResultToast,
  showOperationalBulkRevertedToast,
  showOperationalBulkRevertErrorToast,
} from './OperationalBulkContract'
import type { OperationalBulkPreview } from './OperationalBulkPreviewModal'

export type OperationalBulkVariables = {
  action: string
  ids?: number[]
  payload?: Record<string, any>
  targetLabels?: string[]
}

export type OperationalBulkRequest = {
  action: string
  ids: number[]
  payload: Record<string, any>
}

export type OperationalBulkExecutionResult = {
  changed_count?: number
  changed?: number
  unchanged_count?: number
  changed_ids?: unknown
  [key: string]: any
}

export type OperationalBulkRevertRequest = {
  action: string
  ids: number[]
  payload?: Record<string, any>
}

export type OperationalBulkOperationState = {
  action: string
  payload: Record<string, any>
  ids: number[]
  actionLabel: string
  fieldLabel?: string
  nextValue?: string
  preview: OperationalBulkPreview
  result?: {
    selected_count: number
    changed_count: number
    unchanged_count: number
    can_revert: boolean
    purge_impact?: OperationalBulkPreview['purge_impact']
  }
  onRevert?: () => Promise<void>
}

export type OperationalBulkSuccessContext<TSnapshot> = {
  action: string
  ids: number[]
  payload: Record<string, any>
  targetLabels?: string[]
  executionStartContext?: unknown
  result: OperationalBulkExecutionResult
  changedIds: number[]
  previousSnapshots: TSnapshot[]
}

export type OperationalBulkRevertContext<TSnapshot> = OperationalBulkSuccessContext<TSnapshot> & {
  changedSnapshots: TSnapshot[]
}

type UseOperationalBulkWorkflowOptions<TSnapshot> = {
  selectedIds: readonly number[]
  fieldLabels: Record<string, string>
  selectionErrorMessage: string
  previewErrorMessage: string
  executionErrorMessage: string
  revertErrorMessage: string
  getSnapshots: (ids: readonly number[]) => TSnapshot[]
  previewRequest: (request: OperationalBulkRequest) => Promise<OperationalBulkPreview>
  executeRequest: (request: OperationalBulkRequest) => Promise<OperationalBulkExecutionResult>
  refresh: () => void | Promise<unknown>
  buildRevertRequest: (context: OperationalBulkRevertContext<TSnapshot>) => OperationalBulkRevertRequest | null
  onPreviewAccepted?: (state: OperationalBulkOperationState) => void | Promise<void>
  onExecutionStart?: (ids: number[], action?: string) => unknown
  onExecutionSettled?: (ids: number[]) => void
  onExecutionSuccess?: (context: OperationalBulkSuccessContext<TSnapshot>) => void | Promise<void>
  onRevertSuccess?: (context: OperationalBulkSuccessContext<TSnapshot>) => void | Promise<void>
}

const uniqueIds = (ids: readonly number[]) => Array.from(new Set(
  ids.map(Number).filter((id) => Number.isFinite(id) && id > 0),
))

const getActionLabel = (action: string, fieldLabel?: string) => (
  action === 'delete'
    ? 'Archive selection'
    : action === 'restore'
      ? 'Restore selection'
      : action === 'purge'
        ? 'Purge selection'
        : `Apply ${fieldLabel || 'change'}`
)

const getNextValue = (action: string, payload: Record<string, any>) => (
  action === 'update'
    ? String(Object.values(payload).find((value) => value !== undefined) ?? '')
    : undefined
)

const getChangedIds = (result: OperationalBulkExecutionResult, selectedIds: readonly number[], changedCount: number) => {
  const responseIds = Array.isArray(result?.changed_ids) ? uniqueIds(result.changed_ids) : []
  const selectedSet = new Set(selectedIds)
  const isExact = responseIds.length === changedCount && responseIds.every((id) => selectedSet.has(id))
  return isExact ? responseIds : []
}

export function useOperationalBulkWorkflow<TSnapshot>({
  selectedIds,
  fieldLabels,
  selectionErrorMessage,
  previewErrorMessage,
  executionErrorMessage,
  revertErrorMessage,
  getSnapshots,
  previewRequest,
  executeRequest,
  refresh,
  buildRevertRequest,
  onPreviewAccepted,
  onExecutionStart,
  onExecutionSettled,
  onExecutionSuccess,
  onRevertSuccess,
}: UseOperationalBulkWorkflowOptions<TSnapshot>) {
  const [bulkOperationPreview, updateBulkOperationPreview] = useState<OperationalBulkOperationState | null>(null)
  const [isBulkReverting, setIsBulkReverting] = useState(false)
  const previewGeneration = useRef(0)

  useEffect(() => () => { previewGeneration.current += 1 }, [])

  const setBulkOperationPreview = useCallback((state: SetStateAction<OperationalBulkOperationState | null>) => {
    // Dismissal also invalidates requests that have not produced a dialog yet.
    previewGeneration.current += 1
    updateBulkOperationPreview(state)
  }, [])

  const resolveIds = useCallback((overrideIds?: number[]) => {
    const ids = uniqueIds(overrideIds ?? selectedIds)
    if (!ids.length) throw new Error(selectionErrorMessage)
    return ids
  }, [selectedIds, selectionErrorMessage])

  const bulkPreviewMutation = useMutation({
    mutationFn: async ({ action, ids: overrideIds, payload = {} }: OperationalBulkVariables & { generation: number }) => {
      const ids = resolveIds(overrideIds)
      const preview = await previewRequest({ action, ids, payload })
      const fieldLabel = action === 'update' ? resolveBulkFieldLabel(payload, fieldLabels) : undefined
      return {
        action,
        ids,
        payload,
        actionLabel: getActionLabel(action, fieldLabel),
        fieldLabel,
        nextValue: getNextValue(action, payload),
        preview,
      } satisfies OperationalBulkOperationState
    },
    onSuccess: async (state, variables) => {
      if (variables.generation !== previewGeneration.current) return
      updateBulkOperationPreview(state)
      await onPreviewAccepted?.(state)
    },
    onError: (error: any, variables) => {
      if (variables.generation === previewGeneration.current) {
        showOperationalBulkErrorToast(error?.message || previewErrorMessage)
      }
    },
  })

  const bulkMutation = useMutation({
    onMutate: ({ action, ids: overrideIds, payload = {} }: OperationalBulkVariables) => {
      const ids = uniqueIds(overrideIds ?? selectedIds)
      const executionStartContext = ids.length ? onExecutionStart?.(ids, action) : undefined
      const ownsPreview = bulkOperationPreview?.action === action
        && bulkOperationPreview.ids.length === ids.length
        && bulkOperationPreview.ids.every((id) => ids.includes(id))
        && Object.keys(bulkOperationPreview.payload).length === Object.keys(payload).length
        && Object.keys(payload).every((key) => Object.is(bulkOperationPreview.payload[key], payload[key]))
      return {
        ids,
        executionStartContext,
        preview: ownsPreview ? bulkOperationPreview : null,
        generation: previewGeneration.current,
      }
    },
    mutationFn: async ({ action, ids: overrideIds, payload = {}, targetLabels }: OperationalBulkVariables) => {
      const ids = resolveIds(overrideIds)
      const previousSnapshots = getSnapshots(ids)
      const result = await executeRequest({ action, ids, payload })
      return { result, action, ids, payload, targetLabels, previousSnapshots }
    },
    onSuccess: async ({ result, action, ids, payload, targetLabels, previousSnapshots }, _variables, context) => {
      await refresh()

      const totalSelected = ids.length
      const changedCount = Number(result?.changed_count ?? result?.changed ?? 0)
      const unchangedCount = Number(result?.unchanged_count ?? Math.max(0, totalSelected - changedCount))
      const changedIds = getChangedIds(result, ids, changedCount)
      const changedSnapshots = previousSnapshots.filter((snapshot: any) => changedIds.includes(Number(snapshot?.id)))
      const successContext: OperationalBulkSuccessContext<TSnapshot> = {
        action,
        ids,
        payload,
        targetLabels,
        executionStartContext: context?.executionStartContext,
        result,
        changedIds,
        previousSnapshots,
      }

      await onExecutionSuccess?.(successContext)

      const revertRequest = changedCount > 0 && action !== 'purge' && changedIds.length === changedCount
        ? buildRevertRequest({ ...successContext, changedSnapshots })
        : null

      let revertInFlight: Promise<void> | null = null
      let revertApplied = false
      let revertComplete = false
      const receiptRevert = revertRequest ? (): Promise<void> => {
        if (revertInFlight) return revertInFlight
        if (revertComplete) return Promise.resolve()
        // The toast and receipt share one undo. A refresh retry must not repeat a write.
        revertInFlight = (async () => {
          try {
            if (!revertApplied) {
              await executeRequest({
                action: revertRequest.action,
                ids: uniqueIds(revertRequest.ids),
                payload: revertRequest.payload || {},
              })
              revertApplied = true
            }
            await refresh()
            await onRevertSuccess?.(successContext)
            revertComplete = true
            showOperationalBulkRevertedToast()
            updateBulkOperationPreview((current) => current?.onRevert === receiptRevert ? null : current)
          } catch (error: any) {
            showOperationalBulkRevertErrorToast(error?.message || revertErrorMessage)
            throw error
          }
        })().finally(() => { revertInFlight = null })
        return revertInFlight
      } : undefined

      updateBulkOperationPreview((current) => current && current === context?.preview && context.generation === previewGeneration.current ? {
        ...current,
        result: {
          selected_count: totalSelected,
          changed_count: changedCount,
          unchanged_count: unchangedCount,
          can_revert: Boolean(receiptRevert),
          ...(result?.purge_impact ? { purge_impact: result.purge_impact } : {}),
        },
        onRevert: receiptRevert,
      } : current)

      showOperationalBulkResultToast({
        action: action === 'delete' ? 'archive' : action as any,
        totalSelected,
        changedCount,
        unchangedCount,
        fieldLabel: action === 'update' ? resolveBulkFieldLabel(payload, fieldLabels) : undefined,
        onRevert: receiptRevert,
      })
    },
    onError: (error: any) => showOperationalBulkErrorToast(error?.message || executionErrorMessage),
    onSettled: (_data, _error, variables, context) => {
      const ids = context?.ids?.length ? context.ids : uniqueIds(variables.ids ?? selectedIds)
      if (ids.length) onExecutionSettled?.(ids)
    },
  })

  const requestBulkPreview = useCallback((variables: OperationalBulkVariables) => {
    const generation = ++previewGeneration.current
    bulkPreviewMutation.mutate({ ...variables, generation })
  }, [bulkPreviewMutation])

  const runBulkReceiptRevert = useCallback(async () => {
    if (!bulkOperationPreview?.onRevert) return
    setIsBulkReverting(true)
    try {
      await bulkOperationPreview.onRevert()
    } finally {
      setIsBulkReverting(false)
    }
  }, [bulkOperationPreview])

  return {
    bulkMutation,
    bulkPreviewMutation,
    bulkOperationPreview,
    isBulkReverting,
    requestBulkPreview,
    runBulkReceiptRevert,
    setBulkOperationPreview,
  }
}
