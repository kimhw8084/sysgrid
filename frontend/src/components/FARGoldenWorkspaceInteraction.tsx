import React, { useEffect, useMemo, useState } from 'react'
import { AppDropdown } from './shared/AppDropdown'
import {
  OperationalGroupedGridSection,
  OperationalGroupedGridView,
} from './shared/OperationalWorkspaceShells'
import { OperationalDataGrid } from './shared/OperationalDataGrid'
import { getOperationalGridRowHeight } from './shared/OperationalGridSizing'
import { useOperationalGroupedSelection } from './shared/OperationalGridInteractions'
import {
  FAR_GROUP_OPTIONS,
  FAR_RISK_BAND_OPTIONS,
  groupFarModes,
  type FarGroupBy,
  type FarQuickFilters,
} from './FAR.workspaceModel'

export function FARFilterBar({
  quickFilters,
  setQuickFilters,
  systems,
  failureTypes,
  statuses,
}: {
  quickFilters: FarQuickFilters
  setQuickFilters: React.Dispatch<React.SetStateAction<FarQuickFilters>>
  systems: string[]
  failureTypes: string[]
  statuses: string[]
}) {
  const update = (key: keyof FarQuickFilters, value: string | string[]) => {
    const next = Array.isArray(value) ? value : [value]
    setQuickFilters((current) => ({ ...current, [key]: next }))
  }

  return (
    <div className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-4">
      <AppDropdown
        multi
        value={quickFilters.system_name}
        onChange={(value) => update('system_name', value)}
        options={systems.map((value) => ({ value, label: value }))}
        label="System Filter"
        placeholder="All systems"
      />
      <AppDropdown
        multi
        value={quickFilters.failure_type}
        onChange={(value) => update('failure_type', value)}
        options={failureTypes.map((value) => ({ value, label: value }))}
        label="Failure Type Filter"
        placeholder="All failure types"
      />
      <AppDropdown
        multi
        value={quickFilters.status}
        onChange={(value) => update('status', value)}
        options={statuses.map((value) => ({ value, label: value }))}
        label="Status Filter"
        placeholder="All statuses"
      />
      <AppDropdown
        multi
        value={quickFilters.risk_band}
        onChange={(value) => update('risk_band', value)}
        options={FAR_RISK_BAND_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        label="RPN Risk Filter"
        placeholder="All risk bands"
      />
    </div>
  )
}

export function FAROperationalGridView({
  gridRef,
  rows,
  groupBy,
  selectionScopeKey,
  selectedIds,
  setSelectedIds,
  columnDefs,
  runtime,
  rowInteractions,
  contextMenu,
  gridContext,
  getRowClass,
  fontSize,
  rowDensity,
  loading,
  dataState,
  loadingIcon,
  loadingLabel,
}: {
  gridRef: React.RefObject<any>
  rows: any[]
  groupBy: FarGroupBy
  selectionScopeKey: string
  selectedIds: number[]
  setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>
  columnDefs: any[]
  runtime: any
  rowInteractions: any
  contextMenu: any
  gridContext: any
  getRowClass: (params: any) => string
  fontSize: number
  rowDensity: number
  loading: boolean
  dataState: any
  loadingIcon: React.ReactNode
  loadingLabel: React.ReactNode
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const groupedSections = useMemo(() => groupFarModes(rows, groupBy), [groupBy, rows])
  const { handleSelectionChanged } = useOperationalGroupedSelection({
    setSelectedIds,
    selectionScopeKey,
  })

  useEffect(() => {
    if (groupBy === 'raw') return
    setCollapsedGroups((current) => {
      const next = { ...current }
      groupedSections.forEach((section) => {
        if (!(section.key in next)) next[section.key] = false
      })
      Object.keys(next).forEach((key) => {
        if (!groupedSections.some((section) => section.key === key)) delete next[key]
      })
      return next
    })
  }, [groupBy, groupedSections])

  if (groupBy === 'raw' || loading || dataState?.kind !== 'ready' || rows.length === 0) {
    return (
      <OperationalDataGrid
        gridRef={gridRef}
        rows={rows}
        columnDefs={columnDefs}
        runtime={runtime}
        rowInteractions={rowInteractions}
        contextMenu={contextMenu}
        context={gridContext}
        getRowClass={getRowClass}
        fontSize={fontSize}
        rowDensity={rowDensity}
        noRowsLabel="No failure modes in scope"
        loading={loading}
        loadingIcon={loadingIcon}
        loadingLabel={loadingLabel}
        dataState={dataState}
        selectionScopeKey={selectionScopeKey}
        onSelectionChanged={(event) => handleSelectionChanged(event, 'raw')}
        suppressRowClickSelection={false}
      />
    )
  }

  const groupLabel = FAR_GROUP_OPTIONS.find((option) => option.value === groupBy)?.label || groupBy
  const selected = new Set(selectedIds.map(Number))

  return (
    <OperationalGroupedGridView
      summary={
        <div>
          <p className="operational-group-summary-kicker">Grouped failure matrix</p>
          <p className="operational-group-summary-value">Grouped by {groupLabel}</p>
        </div>
      }
      actions={
        <>
          <button
            type="button"
            onClick={() => setCollapsedGroups(Object.fromEntries(groupedSections.map((section) => [section.key, false])))}
            className="operational-group-control"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={() => setCollapsedGroups(Object.fromEntries(groupedSections.map((section) => [section.key, true])))}
            className="operational-group-control"
          >
            Collapse All
          </button>
        </>
      }
      sections={groupedSections.map((section) => {
        const isCollapsed = Boolean(collapsedGroups[section.key])
        const selectedCount = section.items.filter((mode) => selected.has(Number(mode.id))).length
        return (
          <OperationalGroupedGridSection
            key={section.key}
            labelMeta={groupLabel}
            label={section.label}
            count={section.items.length}
            countLabel="failure modes"
            selectedCount={selectedCount}
            collapsed={isCollapsed}
            onToggle={() => setCollapsedGroups((current) => ({ ...current, [section.key]: !current[section.key] }))}
          >
            {!isCollapsed ? (
              <OperationalDataGrid
                rows={section.items}
                columnDefs={columnDefs}
                runtime={runtime}
                rowInteractions={rowInteractions}
                contextMenu={contextMenu}
                context={gridContext}
                getRowClass={getRowClass}
                fontSize={fontSize}
                rowDensity={rowDensity}
                noRowsLabel="No failure modes in group"
                selectionScopeKey={selectionScopeKey}
                onSelectionChanged={(event) => handleSelectionChanged(event, section.key)}
                suppressRowClickSelection={false}
                height={`${Math.min(600, section.items.length * getOperationalGridRowHeight(fontSize, rowDensity) + 40)}px`}
              />
            ) : null}
          </OperationalGroupedGridSection>
        )
      })}
    />
  )
}
