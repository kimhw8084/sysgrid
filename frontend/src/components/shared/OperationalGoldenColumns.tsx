import React from 'react'
import { WorkspaceTooltip } from './WorkspaceTooltip'
import {
  OPERATIONAL_GRID_BADGE_CLASS,
  OPERATIONAL_GRID_BADGE_TEXT_CLASS,
  OPERATIONAL_GRID_CLASSES,
  OPERATIONAL_GRID_EMPTY_VALUE_CLASS,
  OPERATIONAL_GRID_PLAIN_VALUE_CLASS,
} from './OperationalGridContract'

export type OperationalMetricTone = 'critical' | 'warning' | 'healthy' | 'info' | 'neutral'

const OPERATIONAL_METRIC_TONE_CLASSES: Record<OperationalMetricTone, string> = {
  critical: 'bg-rose-500/20 text-rose-500 border-rose-500/30',
  warning: 'bg-amber-500/20 text-amber-500 border-amber-500/30',
  healthy: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  info: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  neutral: 'bg-white/5 text-slate-400 border-white/10',
}

export function getOperationalHeaderSafeMinWidth({
  headerName,
  minWidth,
  characterWidth = 7,
  chromeWidth = 48,
}: {
  headerName: string
  minWidth: number
  characterWidth?: number
  chromeWidth?: number
}) {
  const labelLength = String(headerName || '').trim().length
  return Math.max(minWidth, chromeWidth + labelLength * characterWidth)
}

export function getOperationalContentAwareWidth({
  headerName,
  values,
  minWidth,
  fallbackWidth,
  maxDefaultWidth,
  characterWidth = 7,
  chromeWidth = 48,
}: {
  headerName: string
  values: unknown[]
  minWidth: number
  fallbackWidth: number
  maxDefaultWidth: number
  characterWidth?: number
  chromeWidth?: number
}) {
  const longest = [headerName, ...values]
    .map((value) => String(value ?? '').trim().length)
    .reduce((maximum, length) => Math.max(maximum, length), 0)
  const estimatedWidth = chromeWidth + longest * characterWidth
  const headerSafeMinWidth = getOperationalHeaderSafeMinWidth({ headerName, minWidth, characterWidth, chromeWidth })
  return Math.max(headerSafeMinWidth, Math.min(maxDefaultWidth, Math.max(fallbackWidth, estimatedWidth)))
}

export function createOperationalGoldenTextColumn({
  field,
  headerName,
  width,
  minWidth,
  hide,
  filter = true,
  tooltipField = field,
  emptyValue = 'N/A',
  valueClassName = OPERATIONAL_GRID_PLAIN_VALUE_CLASS,
  cellClass,
  headerClass,
  formatValue,
  tooltipValueGetter,
  alignment = 'center',
}: {
  field: string
  headerName: string
  width: number
  minWidth: number
  hide?: boolean
  filter?: any
  tooltipField?: string
  emptyValue?: string
  valueClassName?: string
  cellClass?: string
  headerClass?: string
  formatValue?: (value: any, params: any) => React.ReactNode
  tooltipValueGetter?: (value: any, params: any) => string
  alignment?: 'center' | 'left'
}) {
  return {
    field,
    headerName,
    width,
    minWidth: getOperationalHeaderSafeMinWidth({ headerName, minWidth }),
    filter,
    resizable: true,
    operationalSkipAutoSize: true,
    tooltipField: tooltipValueGetter ? undefined : tooltipField,
    tooltipValueGetter: tooltipValueGetter ? (params: any) => tooltipValueGetter(params.value, params) : undefined,
    cellClass: cellClass || (alignment === 'left' ? OPERATIONAL_GRID_CLASSES.leftBodyCell : OPERATIONAL_GRID_CLASSES.centeredCell),
    headerClass: headerClass || (alignment === 'left' ? OPERATIONAL_GRID_CLASSES.primaryHeader : OPERATIONAL_GRID_CLASSES.centeredHeader),
    cellRenderer: (params: any) => {
      const resolvedValue = formatValue ? formatValue(params.value, params) : params.value
      return resolvedValue !== undefined && resolvedValue !== null && resolvedValue !== ''
        ? <span className={valueClassName}>{resolvedValue}</span>
        : <span className={OPERATIONAL_GRID_EMPTY_VALUE_CLASS}>{emptyValue}</span>
    },
    hide,
  }
}

export function createOperationalMetricBadgeColumn({
  field,
  headerName,
  width,
  minWidth,
  fontSize,
  hide,
  resolveTone,
  onActivate,
  title = 'Open metric definition',
}: {
  field: string
  headerName: string
  width: number
  minWidth: number
  fontSize: number
  hide?: boolean
  resolveTone: (value: number, params: any) => OperationalMetricTone
  onActivate?: (params: any) => void
  title?: string
}) {
  return {
    field,
    headerName,
    width,
    minWidth: getOperationalHeaderSafeMinWidth({ headerName, minWidth }),
    filter: 'agNumberColumnFilter',
    resizable: true,
    operationalSkipAutoSize: true,
    cellClass: OPERATIONAL_GRID_CLASSES.centeredCell,
    headerClass: OPERATIONAL_GRID_CLASSES.centeredHeader,
    cellRenderer: (params: any) => {
      const value = Number(params.value ?? 0)
      const tone = resolveTone(value, params)
      return (
        <div className="flex h-full w-full items-center justify-center">
          <button
            type="button"
            title={title}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onActivate?.(params)
            }}
            className={`${OPERATIONAL_GRID_BADGE_CLASS} min-w-14 cursor-pointer justify-center transition-transform hover:scale-[1.02] ${OPERATIONAL_METRIC_TONE_CLASSES[tone]}`}
          >
            <span style={{ fontSize: `${fontSize}px` }} className={`${OPERATIONAL_GRID_BADGE_TEXT_CLASS} font-bold`}>
              {value}
            </span>
          </button>
        </div>
      )
    },
    hide,
  }
}

export type OperationalLinkedCountCellProps<T> = {
  items: readonly T[] | null | undefined
  fontSize: number
  emptyLabel?: string
  previewTitle: string
  getItemKey: (item: T, index: number) => React.Key
  getItemLabel: (item: T, index: number) => React.ReactNode
  getToneClass: (count: number) => string
  onActivate: (items: T[]) => void
}

export function OperationalLinkedCountCell<T>({
  items,
  fontSize,
  emptyLabel = 'None',
  previewTitle,
  getItemKey,
  getItemLabel,
  getToneClass,
  onActivate,
}: OperationalLinkedCountCellProps<T>) {
  const normalizedItems: T[] = Array.isArray(items) ? [...items] : []
  const count = normalizedItems.length
  if (count === 0) {
    return <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{emptyLabel}</span>
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <WorkspaceTooltip className="inline-flex" content={<>
        <p className="mb-2 font-semibold">{previewTitle}</p>
        <div className="space-y-1">{normalizedItems.map((item, index) => (
          <p key={getItemKey(item, index)}>{getItemLabel(item, index)}</p>
        ))}</div>
      </>}>
        <button
          type="button"
          onClick={() => onActivate(normalizedItems)}
          className={`flex h-5 w-14 cursor-pointer items-center justify-center rounded-lg border shadow-sm transition-all hover:scale-105 active:scale-95 ${getToneClass(count)}`}
        >
          <span style={{ fontSize: `${fontSize}px` }} className="font-bold leading-none">{count}</span>
        </button>
      </WorkspaceTooltip>
    </div>
  )
}
