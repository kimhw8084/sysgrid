import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bug, CheckCircle2, Copy, ExternalLink, Search, Trash2, X } from 'lucide-react'
import { useErrors, SysError } from '../../stores/errorStore'
import { formatAppDate, formatAppTime } from '../../utils/dateUtils'
import { toast } from 'react-hot-toast'
import { redactText } from '../../api/bootstrapDiagnostics'
import { useWorkspaceDialogLayer, WorkspacePortal } from './WorkspaceOverlay'
import { ToolbarButton } from './LayoutPrimitives'
import { WorkspaceDetailFields, WorkspaceDetailSection } from './WorkspaceModalShells'

export function ErrorConsole() {
  const { errors, isOpen, setOpen, clearErrors, acknowledgeError, acknowledgeAll } = useErrors()
  const dialogProps = useWorkspaceDialogLayer(isOpen, () => setOpen(false))
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'frontend' | 'backend'>('all')
  const [showAcknowledged, setShowAcknowledged] = useState(true)
  const selectedTrigger = useRef<HTMLButtonElement | null>(null)
  const detailHeading = useRef<HTMLHeadingElement | null>(null)
  const listHeading = useRef<HTMLHeadingElement | null>(null)
  const previousSelection = useRef<string | null>(null)

  const filteredErrors = useMemo(() => errors.filter(error => {
    const query = searchTerm.toLowerCase()
    const matchesSearch = [error.message, error.url, error.stack].some(value => value?.toLowerCase().includes(query))
    return matchesSearch && (filterType === 'all' || error.type === filterType) && (showAcknowledged || !error.acknowledged)
  }), [errors, searchTerm, filterType, showAcknowledged])
  const selectedError = filteredErrors.find(error => error.id === selectedErrorId)

  useEffect(() => {
    if (!isOpen) { previousSelection.current = null; return }
    if (window.matchMedia('(max-width: 1023px)').matches) {
      if (selectedError && previousSelection.current !== selectedError.id) detailHeading.current?.focus()
      if (!selectedError && previousSelection.current) {
        const trigger = selectedTrigger.current
        if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus()
        else listHeading.current?.focus()
      }
    }
    previousSelection.current = selectedError?.id || null
    if (selectedErrorId && !selectedError) setSelectedErrorId(null)
  }, [isOpen, selectedError?.id, selectedErrorId])

  const copyToClipboard = async (text: string, message = 'Technical details copied') => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(message)
      return true
    } catch {
      toast.error('Clipboard unavailable. Select and copy the details manually.')
      return false
    }
  }
  const buganizerUrl = (
    localStorage.getItem('SYSGRID_BUGANIZER_URL') ||
    localStorage.getItem('SYSGRID_CONFIG_VITE_BUGANIZER_URL') ||
    String(import.meta.env.VITE_BUGANIZER_URL || '')
  ).trim()
  const hasBuganizer = /^https?:\/\//i.test(buganizerUrl)
  const buildSelectedErrorReport = (error: SysError) => redactText([
    'SysGrid runtime error',
    `Message: ${error.message}`,
    `Timestamp: ${error.timestamp}`,
    `Severity: ${error.severity}`,
    `Type: ${error.type}`,
    `View: ${error.view || '<unknown>'}`,
    `Method: ${error.method || '<unknown>'}`,
    `URL: ${error.finalUrl || error.url || '<unknown>'}`,
    `HTTP status: ${error.status || '<none>'} ${error.statusText || ''}`.trim(),
    `Content type: ${error.contentType || '<missing>'}`,
    `Redirected: ${error.redirected ? 'yes' : 'no'}`,
    `Request ID: ${error.requestId || '<missing>'}`,
    `Browser origin: ${error.browserOrigin || window.location.origin}`,
    `Configured API base: ${error.configuredApiBase || '<blank>'}`,
    `Browser online: ${error.browserOnline == null ? '<unknown>' : (error.browserOnline ? 'yes' : 'no')}`,
    '', 'Response excerpt:', error.rawBody || JSON.stringify(error.data || {}, null, 2),
    '', 'Stack:', error.stack || '<none>',
  ].join('\n'))
  const copyBugReport = (error: SysError) => copyToClipboard(buildSelectedErrorReport(error), 'Error report copied')
  const openBuganizer = async (error: SysError) => {
    if (await copyBugReport(error) && hasBuganizer) window.open(buganizerUrl, '_blank', 'noopener,noreferrer')
  }

  if (!isOpen) return null
  return (
    <WorkspacePortal>
      <div {...dialogProps} className="sg-error-console fixed inset-0 flex items-center justify-center bg-[var(--overlay-scrim)] p-2 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="sysgrid-error-console-title">
        <div className="flex max-h-full w-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-base)] text-[var(--text-primary)] shadow-2xl" style={{ height: 'min(900px, calc(100dvh - 1rem))' }}>
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-default)] bg-[var(--surface-elevated)] p-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <Bug size={20} className="shrink-0 text-[var(--state-danger)]" aria-hidden="true" />
              <div>
                <h2 id="sysgrid-error-console-title" className="text-lg font-semibold">Error console</h2>
                <p className="text-xs text-[var(--text-secondary)]">{errors.length} total · {errors.filter(error => !error.acknowledged).length} unacknowledged</p>
              </div>
            </div>
            <ToolbarButton variant="quiet" onClick={() => setOpen(false)} ariaLabel="Close error console"><X size={20} aria-hidden="true" /></ToolbarButton>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
            <div className={`shrink-0 space-y-3 border-b border-[var(--border-default)] p-3 sm:px-5 ${selectedError ? 'hidden lg:block' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative min-w-0 flex-1 basis-56">
                  <span className="sr-only">Search error diagnostics</span>
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" aria-hidden="true" />
                  <input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Search messages, stack traces or endpoints"
                    className="min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--input-bg)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]" />
                </label>
                <button type="button" onClick={() => setShowAcknowledged(!showAcknowledged)} aria-pressed={showAcknowledged}
                  className="min-h-10 rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
                  {showAcknowledged ? 'Showing All' : 'Active Only'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1" role="group" aria-label="Error type">
                  {(['all', 'frontend', 'backend'] as const).map(type => (
                    <button type="button" key={type} onClick={() => setFilterType(type)} aria-pressed={filterType === type}
                      className={`min-h-10 rounded-lg border px-3 text-xs font-semibold capitalize ${filterType === type ? 'border-[var(--action-primary)] bg-[var(--action-primary)] text-white' : 'border-[var(--border-default)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'}`}>
                      {type}
                    </button>
                  ))}
                </div>
                <ToolbarButton onClick={acknowledgeAll} disabled={!errors.some(error => !error.acknowledged)}><CheckCircle2 size={14} aria-hidden="true" /> Acknowledge All</ToolbarButton>
                <ToolbarButton onClick={clearErrors} disabled={!errors.length} variant="danger"><Trash2 size={14} aria-hidden="true" /> Clear console</ToolbarButton>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">Saved history contains metadata only. Detailed diagnostics are available until this page is reloaded.</p>
            </div>
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <section aria-label="Error history" className={`min-w-0 shrink-0 flex-col border-[var(--border-default)] bg-[var(--surface-base)] lg:w-80 lg:border-r ${selectedError ? 'hidden lg:flex' : 'flex'}`}>
                <h3 ref={listHeading} tabIndex={-1} className="px-4 py-3 text-sm font-semibold outline-none">{filteredErrors.length} matching errors</h3>
                <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto custom-scrollbar">
                  {filteredErrors.map(error => (
                    <button type="button" key={error.id} onClick={event => { selectedTrigger.current = event.currentTarget; setSelectedErrorId(error.id) }}
                      aria-label={`Inspect error: ${error.message}`} aria-pressed={selectedErrorId === error.id}
                      className={`block w-full border-b border-[var(--border-default)] p-4 text-left hover:bg-[var(--surface-hover)] ${selectedErrorId === error.id ? 'bg-[var(--action-primary-muted)] ring-1 ring-inset ring-[var(--focus-ring)]' : ''}`}>
                      <span className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                        <span className="capitalize">{error.type}</span>
                        <span className="capitalize text-[var(--state-danger)]">{error.severity}</span>
                        <span>{formatAppTime(error.timestamp)}</span>
                        {error.acknowledged && <span className="text-[var(--state-success)]">Acknowledged</span>}
                      </span>
                      <span className="line-clamp-2 break-words text-sm font-medium [overflow-wrap:anywhere]">{error.message}</span>
                      {error.url && <span className="mt-2 block truncate text-xs text-[var(--text-secondary)]">{error.url}</span>}
                    </button>
                  ))}
                  {!filteredErrors.length && <p className="p-6 text-sm text-[var(--text-secondary)]">No matching errors in the current view.</p>}
                </div>
              </section>
              <section aria-label="Error details" className={`min-w-0 flex-1 flex-col bg-[var(--surface-base)] lg:min-h-0 lg:overflow-y-auto custom-scrollbar ${selectedError ? 'flex' : 'hidden lg:flex'}`}>
                {selectedError ? (
                  <div className="min-w-0 space-y-5 p-3 sm:p-5 [overflow-wrap:anywhere]">
                    <div className="lg:hidden"><ToolbarButton onClick={() => setSelectedErrorId(null)} ariaLabel="Back to error list"><ArrowLeft size={14} aria-hidden="true" /> Back to error list</ToolbarButton></div>
                    <h3 ref={detailHeading} tabIndex={-1} className="text-lg font-semibold leading-relaxed outline-none">{selectedError.message}</h3>
                    <div className="flex flex-wrap gap-2">
                      <ToolbarButton onClick={() => acknowledgeError(selectedError.id)} disabled={selectedError.acknowledged} variant="primary">{selectedError.acknowledged ? 'Acknowledged' : 'Acknowledge error'}</ToolbarButton>
                      <ToolbarButton onClick={() => { void copyBugReport(selectedError) }}><Copy size={14} aria-hidden="true" /> Copy Bug Report</ToolbarButton>
                      <ToolbarButton onClick={() => { void openBuganizer(selectedError) }}><ExternalLink size={14} aria-hidden="true" /> {hasBuganizer ? 'Open Buganizer' : 'Copy Only'}</ToolbarButton>
                    </div>
                    <WorkspaceDetailSection title="Event context">
                      <WorkspaceDetailFields columns={2} fields={[
                        { label: 'Time of failure', value: formatAppDate(selectedError.timestamp) },
                        { label: 'Fault domain', value: selectedError.type },
                        { label: 'Severity', value: selectedError.severity },
                        { label: 'Execution path', value: selectedError.view || '/' },
                      ]} />
                    </WorkspaceDetailSection>
                    {selectedError.url && (
                      <WorkspaceDetailSection title="Request context">
                        <WorkspaceDetailFields columns={1} fields={[
                          { label: 'Endpoint', value: selectedError.url },
                          { label: 'Method', value: selectedError.method || 'GET' },
                          { label: 'Status', value: `${selectedError.status ?? 'N/A'} ${selectedError.statusText || ''}` },
                          { label: 'Content type', value: selectedError.contentType || 'N/A' },
                          { label: 'Final URL', value: selectedError.finalUrl || selectedError.url },
                          { label: 'Request ID', value: selectedError.requestId || 'N/A' },
                        ]} />
                      </WorkspaceDetailSection>
                    )}
                    {selectedError.stack && (
                      <WorkspaceDetailSection title="Technical details">
                        <ToolbarButton onClick={() => { void copyToClipboard(selectedError.stack || '') }} ariaLabel="Copy technical details"><Copy size={14} aria-hidden="true" /> Copy technical details</ToolbarButton>
                        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text-primary)]">{selectedError.stack}</pre>
                      </WorkspaceDetailSection>
                    )}
                    {selectedError.data && (
                      <WorkspaceDetailSection title="Payload inspection">
                        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text-primary)]">{JSON.stringify(selectedError.data, null, 2)}</pre>
                      </WorkspaceDetailSection>
                    )}
                  </div>
                ) : <p className="p-6 text-sm text-[var(--text-secondary)]">Select an error from the list to inspect its request context and captured details.</p>}
                <p className="mt-auto p-4 text-xs leading-relaxed text-[var(--text-secondary)]">Local diagnostics · Up to 100 records. Review detailed reports before sharing.</p>
              </section>
            </div>
          </div>
        </div>
      </div>
    </WorkspacePortal>
  )
}
