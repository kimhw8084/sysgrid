import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspacePopupDismiss } from './WorkspaceOverlay'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, CheckSquare, Clipboard, Download, FileSpreadsheet, FileUp, Plus, Trash2, Upload, X, RefreshCcw, Terminal, Database } from 'lucide-react'
import toast from 'react-hot-toast'
import { showWorkspaceToast } from './WorkspaceToast'
import { apiFetch } from '../../api/apiClient'
import { AppDropdown } from './AppDropdown'
import { WorkspaceModal } from './WorkspaceModal'
import { ToolbarButton } from './LayoutPrimitives'
import { downloadOperationalImportFile } from './OperationalImportExport'
import {
  WorkspaceEmptyState,
  WorkspaceFieldLabel,
  WorkspacePanelSubtitle,
  WorkspacePanelTitle,
  WorkspaceSectionBadge,
  WorkspaceSectionCard,
  WorkspaceSplitView,
  WorkspaceInfoTooltip,
  WorkspaceFloatingPanel,
  useWorkspaceAnchoredLayer,
  WorkspaceCollapsibleHeader,
  WorkspaceValidationBanner,
  getWorkspaceInputClass,
  useBodyModalFlag,
} from './OperationalWorkspacePrimitives'

type ImportMode = 'file' | 'paste' | 'builder'

interface ImportFieldMeta {
  name: string
  label: string
  required: boolean
  description: string
  input_kind: string
  template_hint: string
  aliases: string[]
  accepts_multiple: boolean
  input_control: string
  supported_in_builder: boolean
  unsupported_reason: string
  validation_rules: string[]
  options: Array<{ value: string; label: string; description?: string }>
}

interface ImportSchemaResponse {
  table_name: string
  display_name: string
  fields: ImportFieldMeta[]
  required_fields: string[]
  example_records: Array<{ id: number; label: string }>
}

interface ImportPreviewRow {
  row: number
  source: Record<string, any>
  normalized: Record<string, any>
  status: 'VALID' | 'INVALID'
  errors: string[]
}

interface ImportPreviewResponse {
  table_name: string
  total_rows: number
  valid_rows: number
  invalid_rows: number
  total_errors: number
  results: ImportPreviewRow[]
}

interface OperationalImportModalProps {
  isOpen: boolean
  onClose: () => void
  tableName: string
  displayName: string
}

type TemplateMode = 'raw' | 'hints' | 'example'

const SOURCE_MODES: Array<{ id: ImportMode; label: string; icon: React.ReactNode }> = [
  { id: 'file', label: 'File Upload', icon: <Upload size={14} /> },
  { id: 'paste', label: 'Paste CSV / Grid', icon: <Clipboard size={14} /> },
  { id: 'builder', label: 'Build Rows', icon: <FileSpreadsheet size={14} /> },
]

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function parseDelimitedLine(line: string, delimiter: string) {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === delimiter && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }

    current += char
  }

  values.push(current)
  return values.map((value) => value.replace(/\r/g, '').trim())
}

function parseDelimitedText(text: string) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)

  if (lines.length === 0) return { delimiter: ',', rows: [] as string[][] }

  const delimiter = lines[0].includes('\t') ? '\t' : ','
  return {
    delimiter,
    rows: lines.map((line) => parseDelimitedLine(line, delimiter)),
  }
}

function valueToCell(value: any) {
  if (value == null) return ''
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function createEmptyRow(columnNames: string[]) {
  return columnNames.reduce<Record<string, string>>((row, columnName) => {
    row[columnName] = ''
    return row
  }, {})
}

function isMeaningfulRow(row: Record<string, string>, columnNames: string[]) {
  return columnNames.some((columnName) => (row[columnName] || '').trim().length > 0)
}

function stringifyPreviewValue(value: any) {
  if (value == null || value === '') return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function getChoicePreview(options: Array<{ value: string; label: string }>) {
  if (options.length === 0) return ''
  const labels = options.slice(0, 4).map((option) => option.label)
  return options.length > 4 ? `${labels.join(', ')} +${options.length - 4} more` : labels.join(', ')
}

export function OperationalImportModal({
  isOpen,
  onClose,
  tableName,
  displayName,
}: OperationalImportModalProps) {
  useBodyModalFlag()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lifecycleRef = useRef(0)
  const [mode, setMode] = useState<ImportMode>('file')
  const [file, setFile] = useState<File | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [draftRows, setDraftRows] = useState<Array<Record<string, string>>>([])
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [selectedPreviewRows, setSelectedPreviewRows] = useState<number[]>([])
  const [templateMode, setTemplateMode] = useState<TemplateMode>('raw')
  const [exampleRecordId, setExampleRecordId] = useState<number | null>(null)
  const [isPickerOpening, setIsPickerOpening] = useState(false)
  const [isTemplateCollapsed, setIsTemplateCollapsed] = useState(false)
  const [isValidationPopoutOpen, setIsValidationPopoutOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const isDirty = Boolean(
    file ||
    pasteText.trim().length > 0 ||
    preview ||
    selectedPreviewRows.length > 0 ||
    draftRows.some((row) => isMeaningfulRow(row, Object.keys(row)))
  )

  useEffect(() => {
    lifecycleRef.current += 1
    return () => { lifecycleRef.current += 1 }
  }, [isOpen, tableName])

  const { triggerRef: validationTriggerRef, panelRef: validationPanelRef, panelStyle: validationPanelStyle } = useWorkspaceAnchoredLayer(isValidationPopoutOpen, { minWidth: 360, offset: 12 })

  const schemaQuery = useQuery({
    queryKey: ['operational-import-schema', tableName],
    queryFn: async () => {
      const response = await apiFetch(`/api/v1/import/schema/${tableName}`)
      return response.json() as Promise<ImportSchemaResponse>
    },
    enabled: isOpen,
  })

  const schema = schemaQuery.data
  const fieldMap = useMemo(
    () => new Map((schema?.fields || []).map((field) => [field.name, field])),
    [schema?.fields]
  )
  const requiredFieldNames = schema?.required_fields || []

  useEffect(() => {
    if (!schema || !isOpen) return
    setSelectedColumns((current) => {
      if (current.length > 0) return current
      return schema.fields.filter((field) => field.supported_in_builder !== false).map((field) => field.name)
    })
    setDraftRows((current) => {
      if (current.length > 0) return current
      return [createEmptyRow(schema.fields.map((field) => field.name))]
    })
    setExampleRecordId((current) => current ?? schema.example_records?.[0]?.id ?? null)
  }, [schema, isOpen])

  useEffect(() => {
    if (!preview) return
    const validRowNumbers = preview.results.filter((result) => result.status === 'VALID').map((result) => result.row)
    setSelectedPreviewRows(validRowNumbers)
  }, [preview])

  useWorkspacePopupDismiss(isValidationPopoutOpen, validationTriggerRef, validationPanelRef, () => setIsValidationPopoutOpen(false))

  useEffect(() => {
    if (!isOpen) {
      setMode('file')
      setFile(null)
      setPasteText('')
      setPreview(null)
      setSelectedPreviewRows([])
      setSelectedColumns([])
      setDraftRows([])
      setTemplateMode('raw')
      setExampleRecordId(null)
      setIsMaximized(false)
      setIsPickerOpening(false)
      setIsTemplateCollapsed(false)
      setIsValidationPopoutOpen(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isPickerOpening) return
    const timer = setTimeout(() => {
      const handleFocus = () => setIsPickerOpening(false)
      window.addEventListener('focus', handleFocus, { once: true })
    }, 500)
    const safetyTimeout = window.setTimeout(() => setIsPickerOpening(false), 8000)
    return () => {
      window.removeEventListener('focus', () => setIsPickerOpening(false))
      window.clearTimeout(safetyTimeout)
      clearTimeout(timer)
    }
  }, [isPickerOpening])

  const supportedFields = useMemo(
    () => (schema?.fields || []).filter((field) => field.supported_in_builder !== false),
    [schema?.fields]
  )
  const unsupportedFields = useMemo(
    () => (schema?.fields || []).filter((field) => field.supported_in_builder === false),
    [schema?.fields]
  )
  const activeColumns = useMemo(() => {
    if (!schema) return []
    const selected = new Set([...requiredFieldNames, ...selectedColumns])
    return supportedFields.filter((field) => selected.has(field.name))
  }, [requiredFieldNames, selectedColumns, supportedFields])

  const nonFileRows = useMemo(() => {
    const columnNames = activeColumns.map((field) => field.name)
    return draftRows.filter((row) => isMeaningfulRow(row, columnNames))
  }, [activeColumns, draftRows])

  const previewMutation = useMutation({
    mutationFn: async (_lifecycle: number) => {
      if (mode === 'file') {
        if (!file) throw new Error('Select a CSV or Excel file first.')
        const formData = new FormData()
        formData.append('table_name', tableName)
        formData.append('file', file)
        const response = await apiFetch('/api/v1/import/preview-file', {
          method: 'POST',
          body: formData,
          headers: {},
        })
        return response.json() as Promise<ImportPreviewResponse>
      }

      if (nonFileRows.length === 0) throw new Error('Add at least one row before validating.')
      const response = await apiFetch(`/api/v1/import/preview-rows?table_name=${tableName}`, {
        method: 'POST',
        body: JSON.stringify({ rows: nonFileRows }),
      })
      return response.json() as Promise<ImportPreviewResponse>
    },
    onSuccess: (data, lifecycle) => {
      if (!isOpen || lifecycle !== lifecycleRef.current) return
      setPreview(data)
      showWorkspaceToast(`Validated ${data.total_rows} row${data.total_rows === 1 ? '' : 's'}`)
    },
    onError: (error: any, lifecycle) => {
      if (!isOpen || lifecycle !== lifecycleRef.current) return
      showWorkspaceToast(error.message || 'Preview failed', { type: 'error' })
    },
  })

  const executeMutation = useMutation({
    mutationFn: async (_lifecycle: number) => {
      if (!preview) throw new Error('Validate rows before importing.')
      const selectedRows = preview.results
        .filter((result) => result.status === 'VALID' && selectedPreviewRows.includes(result.row))
        .map((result) => result.source)

      if (selectedRows.length === 0) throw new Error('Select at least one valid row to import.')
      const response = await apiFetch(`/api/v1/import/execute?table_name=${tableName}`, {
        method: 'POST',
        body: JSON.stringify({ rows: selectedRows }),
      })
      return response.json()
    },
    onSuccess: (data: any, lifecycle) => {
      // A completed write still invalidates cached data after external closure,
      // but its receipt must not dismiss or repaint a replacement dialog.
      if (data.status === 'success') queryClient.invalidateQueries()
      if (!isOpen || lifecycle !== lifecycleRef.current) return
      if (data.status !== 'success') {
        showWorkspaceToast(data.errors?.join(', ') || 'Import failed', { type: 'error' })
        return
      }
      showWorkspaceToast(`Imported ${data.count} row${data.count === 1 ? '' : 's'}`)
      onClose()
    },
    onError: (error: any, lifecycle) => {
      if (!isOpen || lifecycle !== lifecycleRef.current) return
      showWorkspaceToast(error.message || 'Import failed', { type: 'error' })
    },
  })

  const isBusy = previewMutation.isPending || executeMutation.isPending

  const toggleColumn = (columnName: string) => {
    if (requiredFieldNames.includes(columnName)) return
    setSelectedColumns((current) => (
      current.includes(columnName)
        ? current.filter((name) => name !== columnName)
        : [...current, columnName]
    ))
    setPreview(null)
  }

  const selectAllOptionalColumns = () => {
    setSelectedColumns(supportedFields.map((field) => field.name))
    setPreview(null)
  }

  const unselectAllOptionalColumns = () => {
    setSelectedColumns([])
    setPreview(null)
  }

  const updateDraftCell = (rowIndex: number, columnName: string, value: string) => {
    if (isBusy) return
    setDraftRows((current) => current.map((row, index) => (
      index === rowIndex ? { ...row, [columnName]: value } : row
    )))
    setPreview(null)
  }

  const addDraftRow = () => {
    const nextRow = createEmptyRow(schema?.fields.map((field) => field.name) || [])
    setDraftRows((current) => [...current, nextRow])
    setPreview(null)
  }

  const removeDraftRow = (rowIndex: number) => {
    setDraftRows((current) => current.filter((_, index) => index !== rowIndex))
    setPreview(null)
  }

  const clearDraftRows = () => {
    const nextRow = createEmptyRow(schema?.fields.map((field) => field.name) || [])
    setDraftRows([nextRow])
    setPreview(null)
  }

  const loadPastedRows = () => {
    if (!schema) return
    if (!pasteText.trim()) {
      showWorkspaceToast('Paste CSV or spreadsheet data first.')
      return
    }

    const parsed = parseDelimitedText(pasteText)
    if (parsed.rows.length === 0) {
      showWorkspaceToast('No rows were found in the pasted data.')
      return
    }

    const fieldLookup = new Map<string, string>()
    supportedFields.forEach((field) => {
      fieldLookup.set(normalizeHeader(field.name), field.name)
      fieldLookup.set(normalizeHeader(field.label), field.name)
      field.aliases.forEach((alias) => fieldLookup.set(normalizeHeader(alias), field.name))
    })

    const firstRow = parsed.rows[0]
    const matchedHeaderCount = firstRow.filter((cell) => fieldLookup.has(normalizeHeader(cell))).length
    const hasHeader = matchedHeaderCount > 0
    const headerRow = hasHeader
      ? firstRow.map((cell) => fieldLookup.get(normalizeHeader(cell)) || '')
      : activeColumns.map((field) => field.name)
    const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows

    const nextRows = dataRows
      .filter((row) => row.some((cell) => cell.trim().length > 0))
      .map((row) => {
        const nextRow = createEmptyRow(schema.fields.map((field) => field.name))
        row.forEach((cell, cellIndex) => {
          const columnName = headerRow[cellIndex]
          if (columnName) nextRow[columnName] = cell
        })
        return nextRow
      })

    if (nextRows.length === 0) {
      showWorkspaceToast('No importable rows were found in the pasted data.')
      return
    }

    setDraftRows(nextRows)
    setMode('builder')
    setPreview(null)
    showWorkspaceToast(`Loaded ${nextRows.length} row${nextRows.length === 1 ? '' : 's'} into the builder`)
  }

  const handlePastedFile = (event: React.ClipboardEvent<HTMLButtonElement | HTMLDivElement>) => {
    const clipboardFiles = Array.from(event.clipboardData.files || [])
    const pastedFile = clipboardFiles.find((candidate) => /\.(csv|xlsx|xls)$/i.test(candidate.name))
    if (!pastedFile) {
      showWorkspaceToast('Clipboard does not contain a CSV or Excel file.')
      return
    }
    event.preventDefault()
    setFile(pastedFile)
    setMode('file')
    setPreview(null)
    showWorkspaceToast(`Loaded ${pastedFile.name} from clipboard`)
  }

  const handleCellPaste = (rowIndex: number, columnIndex: number, text: string) => {
    if (!schema) return
    const parsed = parseDelimitedText(text)
    if (parsed.rows.length <= 1 && parsed.rows[0]?.length <= 1) return

    const allColumnNames = activeColumns.map((field) => field.name)
    setDraftRows((current) => {
      const nextRows = [...current]
      const neededRowCount = rowIndex + parsed.rows.length
      while (nextRows.length < neededRowCount) {
        nextRows.push(createEmptyRow(schema.fields.map((field) => field.name)))
      }
      parsed.rows.forEach((cells, rowOffset) => {
        const nextRow = { ...nextRows[rowIndex + rowOffset] }
        cells.forEach((cell, cellOffset) => {
          const columnName = allColumnNames[columnIndex + cellOffset]
          if (columnName) nextRow[columnName] = cell
        })
        nextRows[rowIndex + rowOffset] = nextRow
      })
      return nextRows
    })
    setPreview(null)
  }

  const handleDownloadTemplate = async () => {
    const includedColumns = activeColumns
      .filter((field) => !field.required)
      .map((field) => field.name)
      .join(',')

    try {
      await downloadOperationalImportFile({
        tableName,
        kind: 'template',
        params: {
          columns: includedColumns || undefined,
          mode: templateMode,
          example_id: templateMode === 'example' && exampleRecordId != null ? exampleRecordId : undefined,
        },
      })
    } catch (error: any) {
      showWorkspaceToast(error.message || 'Template download failed', { type: 'error' })
    }
  }

  const togglePreviewRow = (rowNumber: number) => {
    setSelectedPreviewRows((current) => (
      current.includes(rowNumber)
        ? current.filter((value) => value !== rowNumber)
        : [...current, rowNumber]
    ))
  }

  const previewErrors = preview?.results.flatMap((result) => result.errors.map((error) => `Row ${result.row}: ${error}`)) || []
  const previewErrorCount = preview?.total_errors ?? previewErrors.length
  const selectedImportCount = preview?.results.filter((result) => result.status === 'VALID' && selectedPreviewRows.includes(result.row)).length || 0

  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false)
  const { triggerRef: templateTriggerRef, panelRef: templatePanelRef, panelStyle: templatePanelStyle } = useWorkspaceAnchoredLayer(isTemplateMenuOpen)

  useEffect(() => {
    if (!isTemplateMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (templateTriggerRef.current?.contains(e.target as Node) || templatePanelRef.current?.contains(e.target as Node)) return
      setIsTemplateMenuOpen(false)
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [isTemplateMenuOpen, templatePanelRef, templateTriggerRef])

  return (
    <WorkspaceModal
      isOpen={isOpen}
      onClose={() => {
        if (isBusy) {
          showWorkspaceToast('Wait for the current import request to finish before closing.')
          return
        }
        onClose()
      }}
      isDirty={isDirty && !isBusy}
      size="workspace"
      isMaximized={isMaximized}
      onMaximizeToggle={() => setIsMaximized(!isMaximized)}
      title={`${displayName} Import`}
      status={isBusy ? <span role="status" className="text-xs font-medium text-[var(--text-secondary)]">
        {executeMutation.isPending ? 'Importing selected rows...' : 'Validating import rows...'}
      </span> : undefined}
      subtitle={(
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-[10px] font-bold text-slate-400">
          <p className="flex min-w-0 flex-wrap items-center gap-1.5 uppercase tracking-widest">
            <Plus size={10} className="text-blue-500" /> Target: <span className="text-white">{displayName}</span>
          </p>
          <p className="flex min-w-0 flex-wrap items-center gap-1.5 uppercase tracking-widest">
            <FileSpreadsheet size={10} className="text-blue-500" /> Identifier: <span className="text-white">{tableName}</span>
          </p>
        </div>
      )}
      icon={<Upload size={24} />}
      footerLeft={(
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-slate-400">
            Import only commits checked valid rows. Invalid rows stay in the preview for correction.
          </p>
        </div>
      )}
      footerRight={(
        <div className="flex items-center gap-3 shrink-0">
          <ToolbarButton
            onClick={() => executeMutation.mutate(lifecycleRef.current)}
            disabled={!preview || selectedImportCount === 0 || isBusy}
            variant="primary"
            className="!inline-flex !flex-row !items-center !justify-center gap-2 px-8 !whitespace-nowrap"
          >
            {executeMutation.isPending ? <RefreshCcw className="animate-spin motion-reduce:animate-none mr-2" size={12} /> : <CheckSquare className="mr-2" size={12} />}
            <span className="!whitespace-nowrap">{executeMutation.isPending ? 'Importing...' : `Import ${selectedImportCount || ''}`.trim()}</span>
          </ToolbarButton>
        </div>
      )}
    >
      <fieldset disabled={isBusy} aria-busy={isBusy} aria-label="Import source and preview" className="m-0 min-w-0 border-0 p-0 flex flex-col space-y-8">
        <WorkspaceValidationBanner message={schemaQuery.error ? 'Import schema failed to load. Refresh the workspace and try again.' : undefined} />
        
        <WorkspaceSplitView
          side="left"
          sidebar={(
            <div className="space-y-6">
              <WorkspaceSectionCard>
                <WorkspaceCollapsibleHeader
                  title="Template"
                  subtitle={!isTemplateCollapsed && "Required columns stay included. Optional columns are selectable. Unsupported columns stay visible with reasons."}
                  collapsed={isTemplateCollapsed}
                  onToggle={() => setIsTemplateCollapsed(!isTemplateCollapsed)}
                />
                
                {!isTemplateCollapsed && (
                  <div className="mt-4 grid grid-cols-1 gap-3">
                    {unsupportedFields.length > 0 && (
                      <div className="rounded-lg border border-amber-500/10 bg-amber-500/5 px-3 py-2 text-[9px] font-semibold text-amber-200">
                        {unsupportedFields.length} column{unsupportedFields.length === 1 ? '' : 's'} stay visible but are intentionally disabled in the builder because they require the richer add/edit workspace.
                      </div>
                    )}
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Download Mode</p>
                      <div className="mt-3 flex gap-2">
                        {[
                          { id: 'raw', label: 'Raw', description: 'Headers only.' },
                          { id: 'hints', label: 'Hints', description: 'Headers plus guidance row.' },
                          { id: 'example', label: 'Example', description: 'Hints plus a real record row.' },
                        ].map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            title={option.description}
                            onClick={() => setTemplateMode(option.id as TemplateMode)}
                            className={`flex-1 rounded-lg border px-2 py-2 text-center transition-all ${
                              templateMode === option.id
                                ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                                : 'border-white/10 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <p className="text-[9px] font-black uppercase tracking-widest">{option.label}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={selectAllOptionalColumns}
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-black uppercase text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={unselectAllOptionalColumns}
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-black uppercase text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        Unselect All
                      </button>
                    </div>

                    {templateMode === 'example' && (
                      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                        <WorkspaceFieldLabel label="Example Record" required />
                        <div className="mt-2">
                          <AppDropdown
                            value={exampleRecordId ?? ''}
                            onChange={(value) => { if (!isBusy) setExampleRecordId(value ? Number(value) : null) }}
                            disabled={isBusy}
                            options={(schema?.example_records || []).map((record) => ({
                              value: record.id,
                              label: record.label,
                            }))}
                            placeholder="Select example record"
                          />
                        </div>
                        <p className="mt-2 text-[9px] font-semibold text-slate-500">
                          Downloads a CSV that shows how a valid existing record is shaped.
                        </p>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleDownloadTemplate}
                      disabled={!schema || (templateMode === 'example' && !exampleRecordId)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-blue-300 transition-colors hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Download size={14} />
                      Download Template
                    </button>
                    
                    <div className="mt-4 space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
                      {(schema?.fields || []).map((field) => {
                        const checked = requiredFieldNames.includes(field.name) || selectedColumns.includes(field.name)
                        const fieldOptions = field.options || []
                        const fieldValidationRules = field.validation_rules || []
                        const supportedInBuilder = field.supported_in_builder !== false
                        return (
                          <label
                            key={field.name}
                            className={`flex items-start gap-3 rounded-lg border px-3 py-2 transition-colors cursor-pointer ${
                              supportedInBuilder
                                ? 'border-white/5 bg-black/20 hover:bg-white/[0.02]'
                                : 'border-white/5 bg-slate-950/70 opacity-70 cursor-not-allowed'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 rounded-lg border-white/20 bg-slate-900 text-blue-500 focus:ring-blue-500/40 focus:ring-offset-0 focus:ring-offset-transparent cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                              checked={checked}
                              disabled={requiredFieldNames.includes(field.name) || !supportedInBuilder}
                              onChange={() => toggleColumn(field.name)}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-100">{field.label}</span>
                                {field.required && <WorkspaceSectionBadge tone="rose">Required</WorkspaceSectionBadge>}
                                {!supportedInBuilder && <WorkspaceSectionBadge>Unavailable In Builder</WorkspaceSectionBadge>}
                                {fieldOptions.length > 0 && <WorkspaceSectionBadge tone="blue">Choice</WorkspaceSectionBadge>}
                              </div>
                              <p className="mt-1 text-[9px] font-semibold text-slate-500 leading-relaxed">
                                {supportedInBuilder
                                  ? (field.template_hint || field.description || field.name)
                                  : field.unsupported_reason}
                              </p>
                              {fieldOptions.length > 0 && (
                                <p className="mt-1 text-[8px] font-semibold uppercase tracking-widest text-blue-300/80">
                                  Allowed values: {getChoicePreview(fieldOptions)}
                                </p>
                              )}
                              {fieldValidationRules.length > 0 && (
                                <p className="mt-1 text-[8px] font-semibold uppercase tracking-widest text-amber-300/80">
                                  {fieldValidationRules.join(' ')}
                                </p>
                              )}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </WorkspaceSectionCard>
            </div>
          )}
          main={(
            <div className="space-y-6">
              <WorkspaceSectionCard>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <WorkspacePanelTitle>Source Method</WorkspacePanelTitle>
                    <WorkspacePanelSubtitle>Choose one path, then validate before import.</WorkspacePanelSubtitle>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 bg-black/40 p-1 rounded-lg border border-white/5">
                    {SOURCE_MODES.map((sourceMode) => (
                      <button
                        key={sourceMode.id}
                        type="button"
                        onClick={() => {
                          setMode(sourceMode.id)
                          setPreview(null)
                        }}
                        className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[9px] font-bold uppercase tracking-widest transition-all ${
                          mode === sourceMode.id
                            ? 'bg-blue-600 text-white shadow-lg'
                            : 'text-slate-500 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {sourceMode.icon}
                        {sourceMode.label}
                      </button>
                    ))}
                  </div>
                </div>

                {mode === 'file' && (
                  <div className="mt-6 space-y-4">
                    <input
                      ref={fileInputRef}
                      type="file"
                      aria-label="Import CSV or Excel file"
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      onChange={(event) => {
                        setFile(event.target.files?.[0] || null)
                        setPreview(null)
                        setIsPickerOpening(false)
                      }}
                    />
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                      <button
                        type="button"
                        onClick={() => {
                          fileInputRef.current?.click()
                          // Update state after the dialog begins opening to avoid blocking the main thread
                          setTimeout(() => setIsPickerOpening(true), 0)
                        }}
                        className="flex min-h-[220px] w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-white/10 bg-black/20 text-slate-400 transition-all hover:border-blue-500/30 hover:bg-blue-500/5 group"
                      >
                        <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/10 group-hover:scale-105 transition-transform text-blue-500">
                          <FileUp size={36} />
                        </div>
                        <div className="text-center px-4">
                          <p className="text-[11px] font-black uppercase tracking-widest text-white">{file?.name || (isPickerOpening ? 'Opening...' : 'Browse Vector Source')}</p>
                          <p className="mt-2 text-[9px] font-semibold text-slate-500 uppercase tracking-widest">Choose a CSV or Excel file from disk. Max 10MB.</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onPaste={handlePastedFile}
                        onClick={() => setMode('file')}
                        className="flex min-h-[220px] w-full flex-col items-center justify-center gap-4 rounded-lg border border-white/10 bg-slate-950/60 px-5 text-center text-slate-400 transition-all hover:border-blue-500/30 hover:bg-blue-500/5 focus:border-blue-500/40 focus:outline-none group"
                      >
                        <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/10 group-hover:scale-105 transition-transform text-emerald-500">
                          <Clipboard size={36} />
                        </div>
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-widest text-white">Paste File From Clipboard</p>
                          <p className="mt-2 text-[9px] font-semibold text-slate-500 uppercase tracking-widest leading-relaxed">Click here, then press <span className="text-slate-300 font-bold border-b border-dashed border-slate-500">Ctrl+V</span> or <span className="text-slate-300 font-bold border-b border-dashed border-slate-500">Cmd+V</span> if your OS clipboard contains a real file.</p>
                        </div>
                      </button>
                    </div>
                  </div>
                )}

                {mode === 'paste' && (
                  <div className="mt-6 space-y-4">
                    <div className="relative">
                      <textarea
                        aria-label="CSV or spreadsheet rows"
                        value={pasteText}
                        onChange={(event) => {
                          setPasteText(event.target.value)
                          setPreview(null)
                        }}
                        placeholder="Paste CSV with headers, or paste spreadsheet cells directly..."
                        className="min-h-[260px] w-full rounded-lg border border-white/10 bg-black/40 p-6 font-mono text-[11px] text-blue-400 outline-none transition-all focus:border-blue-500/30 custom-scrollbar resize-none"
                      />
                      {pasteText && (
                        <button
                          type="button"
                          onClick={() => setPasteText('')}
                          className="absolute top-4 right-4 flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-rose-400 transition-colors hover:bg-rose-500/20"
                        >
                          <Trash2 size={12} /> Clear
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <button
                        type="button"
                        onClick={loadPastedRows}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <Clipboard size={14} />
                        Load Into Builder
                      </button>
                      <p className="text-[9px] font-semibold text-slate-500">Header row is optional. If omitted, the active template column order is used.</p>
                    </div>
                  </div>
                )}

                {mode === 'builder' && (
                  <div className="mt-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-black/20 p-4 rounded-lg border border-white/5">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet size={16} className="text-blue-500" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">Manual Data Builder</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={addDraftRow}
                          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white transition-colors hover:bg-blue-500"
                        >
                          <Plus size={12} />
                          Add Row
                        </button>
                        <button
                          type="button"
                          onClick={clearDraftRows}
                          className="inline-flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-rose-300 transition-colors hover:bg-rose-500/20"
                        >
                          <Trash2 size={12} />
                          Clear All
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-white/10 shadow-xl bg-black/40">
                      <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                        <table className="min-w-full divide-y divide-white/5 text-left border-collapse">
                          <thead className="sticky top-0 bg-[#0d0e12] z-10 shadow-md">
                            <tr className="border-b border-white/10">
                              <th className="px-4 py-3 text-center text-[9px] font-black uppercase tracking-widest text-slate-500 w-16">Row</th>
                              {activeColumns.map((field) => (
                                <th key={field.name} className="min-w-[200px] px-4 py-3 text-left">
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">{field.label}</span>
                                      {field.required && <span className="text-rose-400 font-bold">*</span>}
                                    </div>
                                    {(field.options || []).length > 0 && (
                                      <span className="text-[7px] font-bold uppercase tracking-widest text-blue-400">Select value</span>
                                    )}
                                  </div>
                                </th>
                              ))}
                              <th className="px-4 py-3 text-center text-[9px] font-black uppercase tracking-widest text-slate-500 w-20">Act</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {draftRows.map((row, rowIndex) => (
                              <tr key={`draft-row-${rowIndex}`} className="hover:bg-white/[0.02] transition-colors">
                                <td className="px-4 py-3 align-middle text-center text-[10px] font-mono font-bold text-slate-500">#{rowIndex + 1}</td>
                                {activeColumns.map((field, columnIndex) => (
                                  <td key={`${rowIndex}-${field.name}`} className="px-2 py-2 align-middle">
                                    {field.input_control === 'select' ? (
                                      <AppDropdown
                                        disabled={isBusy}
                                        value={row[field.name] || ''}
                                        onChange={(value) => updateDraftCell(rowIndex, field.name, String(value))}
                                        options={(field.options || []).map((option) => ({ value: option.value, label: option.label }))}
                                        placeholder={field.required ? `Select ${field.label}` : `Optional`}
                                      />
                                    ) : (
                                      <input
                                        aria-label={`${field.label}, row ${rowIndex + 1}`}
                                        type={field.input_control === 'number' ? 'number' : 'text'}
                                        value={row[field.name] || ''}
                                        onChange={(event) => updateDraftCell(rowIndex, field.name, event.target.value)}
                                        onPaste={(event) => {
                                          const text = event.clipboardData.getData('text')
                                          if (text.includes('\n') || text.includes('\t')) {
                                            event.preventDefault()
                                            handleCellPaste(rowIndex, columnIndex, text)
                                          }
                                        }}
                                        placeholder={field.template_hint}
                                        className="w-full rounded-lg border border-white/5 bg-black/20 px-3 py-2.5 text-[10px] font-semibold text-slate-200 outline-none transition-all focus:border-blue-500/40 focus:bg-black/40 placeholder:text-slate-600"
                                      />
                                    )}
                                  </td>
                                ))}
                                <td className="px-4 py-3 align-middle text-center">
                                  <button
                                    type="button"
                                    aria-label={`Remove row ${rowIndex + 1}`}
                                    onClick={() => removeDraftRow(rowIndex)}
                                    disabled={draftRows.length === 1}
                                    className="flex items-center justify-center w-8 h-8 mx-auto rounded-lg bg-rose-500/5 text-rose-400 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {draftRows.length === 0 && (
                              <tr>
                                <td colSpan={activeColumns.length + 2} className="px-6 py-12 text-center">
                                  <div className="flex flex-col items-center justify-center space-y-3">
                                    <div className="p-3 bg-white/5 rounded-lg text-slate-500">
                                      <FileSpreadsheet size={24} />
                                    </div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">No rows in builder</p>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </WorkspaceSectionCard>

              <WorkspaceSectionCard className="flex-1">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <WorkspacePanelTitle>Validation & Audit</WorkspacePanelTitle>
                    <WorkspacePanelSubtitle>Validate normalized rows against schema constraints.</WorkspacePanelSubtitle>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    {preview && (
                      <div className="relative">
                        <button
                          type="button"
                          ref={(node) => { validationTriggerRef.current = node }}
                          onClick={() => setIsValidationPopoutOpen((current) => !current)}
                          className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[9px] font-black uppercase tracking-widest transition-all shadow-lg ${
                            previewErrorCount > 0
                              ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 shadow-rose-500/5'
                              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 shadow-emerald-500/5'
                          }`}
                        >
                          <AlertCircle size={14} />
                          Report ({previewErrorCount} Error{previewErrorCount === 1 ? '' : 's'})
                        </button>
                        {isValidationPopoutOpen && typeof document !== 'undefined' && createPortal(
                          <div ref={validationPanelRef} style={validationPanelStyle} data-workspace-panel="true" className="z-[3600]">
                            <WorkspaceFloatingPanel kind="detail" className="p-5 w-80 space-y-5">
                              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                                <div className="flex items-center gap-2">
                                  <Terminal size={14} className="text-blue-500" />
                                  <p className="text-[10px] font-black uppercase tracking-widest text-white">Validation Audit</p>
                                </div>
                                <button aria-label="Close validation report" onClick={() => setIsValidationPopoutOpen(false)} className="text-slate-500 hover:text-rose-400 transition-colors p-1 bg-white/5 rounded-lg">
                                  <X size={12} />
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-lg border border-white/5 bg-black/40 px-3 py-3 text-center flex flex-col items-center gap-1">
                                  <Database size={14} className="text-slate-400" />
                                  <p className="mt-1 text-sm font-black text-white">{preview.total_rows}</p>
                                  <p className="text-[7px] font-black uppercase tracking-widest text-slate-500">Total Rows</p>
                                </div>
                                <div className="rounded-lg border border-blue-500/10 bg-blue-500/5 px-3 py-3 text-center flex flex-col items-center gap-1">
                                  <CheckSquare size={14} className="text-blue-400" />
                                  <p className="mt-1 text-sm font-black text-blue-300">{selectedImportCount}</p>
                                  <p className="text-[7px] font-black uppercase tracking-widest text-blue-400">Selected</p>
                                </div>
                                <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 px-3 py-3 text-center flex flex-col items-center gap-1">
                                  <CheckSquare size={14} className="text-emerald-400" />
                                  <p className="mt-1 text-sm font-black text-emerald-300">{preview.valid_rows}</p>
                                  <p className="text-[7px] font-black uppercase tracking-widest text-emerald-400">Valid</p>
                                </div>
                                <div className="rounded-lg border border-rose-500/10 bg-rose-500/5 px-3 py-3 text-center flex flex-col items-center gap-1">
                                  <AlertCircle size={14} className="text-rose-400" />
                                  <p className="mt-1 text-sm font-black text-rose-300">{preview.invalid_rows}</p>
                                  <p className="text-[7px] font-black uppercase tracking-widest text-rose-400">Invalid</p>
                                </div>
                              </div>
                              <div className="pt-2 border-t border-white/5">
                                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-3">Diagnostic Log</p>
                                <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                                  {previewErrors.map((error, i) => (
                                    <div key={i} className="flex items-start gap-2 rounded-lg border border-rose-500/10 bg-rose-500/5 px-3 py-2 text-[9px] font-bold text-rose-300/90 leading-relaxed">
                                      <div className="w-1 h-1 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                                      {error}
                                    </div>
                                  ))}
                                  {previewErrors.length === 0 && (
                                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/10 bg-emerald-500/5 px-3 py-3 text-[9px] font-bold text-emerald-400 uppercase tracking-widest text-center justify-center">
                                      <CheckSquare size={12} />
                                      All checked valid
                                    </div>
                                  )}
                                </div>
                              </div>
                            </WorkspaceFloatingPanel>
                          </div>,
                          document.body
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => previewMutation.mutate(lifecycleRef.current)}
                      disabled={isBusy || schemaQuery.isLoading}
                      className="inline-flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-6 py-2.5 text-[9px] font-black uppercase tracking-widest text-blue-300 transition-colors hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 shadow-lg shadow-blue-500/5"
                    >
                      {previewMutation.isPending ? <RefreshCcw className="animate-spin motion-reduce:animate-none" size={14} /> : <Terminal size={14} />}
                      {previewMutation.isPending ? 'Auditing...' : 'Initiate Audit'}
                    </button>
                  </div>
                </div>

                {!preview && (
                  <div className="mt-6">
                    <WorkspaceEmptyState
                      compact
                      icon={<CheckSquare size={24} className="text-slate-600" />}
                      title="Awaiting Validation"
                      description="Click 'Initiate Audit' to process your source data and generate a detailed diagnostic report before import."
                    />
                  </div>
                )}

                {preview && (
                  <div className="mt-6 space-y-4">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 flex items-center gap-2">
                        <CheckSquare size={14} /> Normalized Vector Stream
                      </span>
                      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                        Ready to import: {selectedImportCount}
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-white/5 bg-[#0f172a] shadow-xl">
                      <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                        <table className="min-w-full divide-y divide-white/5 text-left border-collapse">
                          <thead className="bg-[#020617] sticky top-0 z-10 shadow-sm border-b border-white/10">
                            <tr>
                              <th className="px-4 py-3 text-center w-12">
                                <input
                                  type="checkbox"
                                  aria-label="Select all valid import rows"
                                  className="rounded-lg border-white/20 bg-slate-900 text-blue-500 focus:ring-0 cursor-pointer"
                                  checked={selectedPreviewRows.length > 0 && selectedPreviewRows.length === preview.valid_rows}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedPreviewRows(preview.results.filter(r => r.status === 'VALID').map(r => r.row))
                                    } else {
                                      setSelectedPreviewRows([])
                                    }
                                  }}
                                />
                              </th>
                              <th className="px-4 py-3 text-left text-[8px] font-black uppercase tracking-widest text-slate-500 w-16">Idx</th>
                              <th className="px-4 py-3 text-center text-[8px] font-black uppercase tracking-widest text-slate-500 w-24">Status</th>
                              {activeColumns.map((field) => (
                                <th key={`preview-${field.name}`} className="min-w-[180px] px-4 py-3 text-left text-[8px] font-black uppercase tracking-widest text-slate-300">
                                  {field.label}
                                </th>
                              ))}
                              <th className="min-w-[280px] px-4 py-3 text-left text-[8px] font-black uppercase tracking-widest text-slate-500">Diagnostics</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {preview.results.map((result) => {
                              const selected = selectedPreviewRows.includes(result.row)
                              return (
                                <tr key={`preview-row-${result.row}`} className={`transition-colors ${selected ? 'bg-blue-500/5 hover:bg-blue-500/10' : 'hover:bg-white/[0.02]'} ${result.status === 'INVALID' ? 'bg-rose-500/[0.03] hover:bg-rose-500/[0.05]' : ''}`}>
                                  <td className="px-4 py-3 align-middle text-center">
                                    <input
                                      type="checkbox"
                                      aria-label={`Select import row ${result.row}`}
                                      checked={selected}
                                      disabled={result.status !== 'VALID'}
                                      onChange={() => togglePreviewRow(result.row)}
                                      className="rounded-lg border-white/20 bg-slate-900 text-blue-500 focus:ring-0 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                                    />
                                  </td>
                                  <td className="px-4 py-3 align-middle text-left text-[10px] font-mono font-bold text-slate-500">#{result.row}</td>
                                  <td className="px-4 py-3 align-middle text-center">
                                    <div className="flex justify-center">
                                      <WorkspaceSectionBadge tone={result.status === 'VALID' ? 'emerald' : 'rose'}>
                                        {result.status}
                                      </WorkspaceSectionBadge>
                                    </div>
                                  </td>
                                  {activeColumns.map((field) => (
                                    <td key={`preview-cell-${result.row}-${field.name}`} className="px-4 py-3 align-middle text-left text-[10px] font-semibold text-slate-200">
                                      <span className="line-clamp-2">{stringifyPreviewValue(result.normalized[field.name] ?? result.source[field.name])}</span>
                                    </td>
                                  ))}
                                  <td className="px-4 py-3 align-middle text-left">
                                    {result.errors.length > 0 ? (
                                      <div className="flex flex-col gap-1.5">
                                        {result.errors.map((error, eIdx) => (
                                          <div key={eIdx} className="flex items-start gap-1.5 text-[9px] font-bold text-rose-400 leading-tight">
                                            <div className="w-1 h-1 rounded-full bg-rose-500 mt-1 shrink-0" />
                                            <span className="uppercase">{error}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-[10px] font-bold text-slate-600">—</span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </WorkspaceSectionCard>
            </div>
          )}
        />
      </fieldset>
    </WorkspaceModal>
  )
}
