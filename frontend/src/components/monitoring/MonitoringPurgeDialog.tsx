import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { apiFetch } from '../../api/apiClient'
import { OperationalBulkPreviewModal, type OperationalBulkPreview, type OperationalBulkResult } from '../shared/OperationalBulkPreviewModal'
import { showWorkspaceToast } from '../shared/WorkspaceToast'

type Preview = OperationalBulkPreview & { selected_ids: number[]; precondition: string }
type Props = {
  ids: number[] | null
  pendingIds: React.MutableRefObject<Set<number>>
  onClose: () => void
  onPurged: (ids: number[]) => void
}

function errorMessage(error: any) {
  return error?.data?.detail?.message || (typeof error?.data?.detail === 'string' ? error.data.detail : error?.message) || 'Purge could not be confirmed. Review a fresh preview.'
}

export function MonitoringPurgeDialog({ ids, pendingIds, onClose, onPurged }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<OperationalBulkResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const generation = useRef(0)
  const execution = useRef(false)
  const mounted = useRef(false)
  const purgedHandler = useRef(onPurged)
  useLayoutEffect(() => { purgedHandler.current = onPurged }, [onPurged])
  const key = ids?.join(',') || ''

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const current = ++generation.current
    setPreview(null); setResult(null); setError('')
    if (!key) { setLoading(false); return }
    setLoading(true)
    const selected = key.split(',').map(Number)
    void apiFetch('/api/v1/monitoring/bulk-action', {
      method: 'POST', body: JSON.stringify({ ids: selected, action: 'purge', dry_run: true }),
    }).then(response => response.json()).then((value: Preview) => {
      if (current !== generation.current || !mounted.current) return
      const returnedIds = [...(value.selected_ids || [])].sort((a, b) => a - b)
      if (typeof value.precondition !== 'string' || !/^[a-f0-9]{64}$/.test(value.precondition)
          || returnedIds.join(',') !== [...selected].sort((a, b) => a - b).join(',')
          || !value.purge_impact?.permanent || value.purge_impact.recovery_supported !== false) {
        throw new Error('The server did not return a complete permanent-purge preview.')
      }
      setPreview(value)
    }).catch(reason => {
      if (current === generation.current && mounted.current) setError(errorMessage(reason))
    }).finally(() => {
      if (current === generation.current && mounted.current) setLoading(false)
    })
    return () => { generation.current++ }
  }, [key, refresh])

  const confirm = async () => {
    if (!preview?.can_execute || loading || error || execution.current) return
    const selected = [...preview.selected_ids]
    if (selected.some(id => pendingIds.current.has(id))) {
      setError('Another operation on this monitor is still pending. Wait, then review a fresh preview.')
      return
    }
    const current = generation.current
    execution.current = true
    selected.forEach(id => pendingIds.current.add(id))
    setExecuting(true)
    try {
      const response = await apiFetch('/api/v1/monitoring/bulk-action', {
        method: 'POST', body: JSON.stringify({ ids: selected, action: 'purge', precondition: preview.precondition }),
      })
      const receipt = await response.json()
      // Revoke stale recovery even when the operator has dismissed the modal.
      purgedHandler.current(receipt.changed_ids)
      if (current === generation.current && mounted.current) setResult({ ...receipt, can_revert: false })
      showWorkspaceToast(`Permanently purged ${receipt.changed_count} monitor${receipt.changed_count === 1 ? '' : 's'}. Recovery is unavailable.`, { type: 'success' })
    } catch (reason) {
      if (current === generation.current && mounted.current) {
        setPreview(null)
        setError(errorMessage(reason))
      } else if (mounted.current) {
        showWorkspaceToast(errorMessage(reason), { type: 'error' })
      }
    } finally {
      selected.forEach(id => pendingIds.current.delete(id))
      execution.current = false
      if (mounted.current) setExecuting(false)
    }
  }

  return <OperationalBulkPreviewModal
    isOpen={Boolean(ids)} workspaceLabel="Monitoring" actionLabel="Permanent purge"
    nextValue={ids ? `Monitoring ${ids.map(id => `#${id}`).join(', ')}` : undefined}
    preview={preview} result={result} isLoading={loading} isExecuting={executing}
    error={error} onRefresh={() => setRefresh(value => value + 1)} onClose={onClose}
    onConfirm={() => { void confirm() }}
  />
}
