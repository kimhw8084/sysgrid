import { readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import {
  FAR_MATURITY_LEVELS,
  createFarAnalyticalColumns,
  getFarIncidentToneClass,
  getFarMaturityLevel,
  getFarVectorSummary,
} from './FAR.gridColumns'
import { OPERATIONAL_GRID_CLASSES } from './shared/OperationalGridContract'
import { OperationalLinkedCountCell } from './shared/OperationalGoldenColumns'

const monitoring = { mitigation_type: 'Monitoring' }
const workaround = { mitigation_type: 'Workaround' }
const resolvedCause = { resolutions: [{ id: 1 }] }

function modeFor(level: number) {
  if (level === 8) return { status: 'Prevented' }
  if (level === 7) return { mitigations: [monitoring, workaround], causes: [resolvedCause] }
  if (level === 6) return { mitigations: [monitoring], causes: [resolvedCause] }
  if (level === 5) return { mitigations: [workaround], causes: [resolvedCause] }
  if (level === 4) return { causes: [resolvedCause] }
  if (level === 3) return { mitigations: [monitoring, workaround] }
  if (level === 2) return { mitigations: [workaround] }
  if (level === 1) return { mitigations: [monitoring] }
  return {}
}

describe('FAR analytical grid convergence', () => {
  it('keeps one canonical maturity algorithm for every level', () => {
    for (let level = 0; level <= 8; level += 1) {
      expect(getFarMaturityLevel(modeFor(level))).toBe(level)
    }
    expect(FAR_MATURITY_LEVELS.map((level) => level.lv)).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0])
  })

  it('derives vector counts once for the grid renderer', () => {
    expect(getFarVectorSummary({
      mitigations: [monitoring, monitoring, workaround, { mitigation_type: 'Other' }],
      causes: [{ resolutions: [{}, {}] }, { resolutions: [{}] }],
      prevention_actions: [{}, {}],
    })).toEqual({
      causes: 2,
      resolutions: 3,
      workarounds: 1,
      monitoring: 2,
      prevention: 2,
    })
  })

  it('preserves incident severity thresholds', () => {
    expect(getFarIncidentToneClass(1)).toContain('purple')
    expect(getFarIncidentToneClass(2)).toContain('amber')
    expect(getFarIncidentToneClass(4)).toContain('amber')
    expect(getFarIncidentToneClass(5)).toContain('rose')
  })

  it('builds Maturity, Vectors, and Incidents behind the operational column contract', () => {
    const openMaturity = vi.fn()
    const openIncidents = vi.fn()
    const columns = createFarAnalyticalColumns({
      fontSize: 11,
      hiddenColumns: ['status', 'vectors', 'linked_rcas'],
      onOpenMaturity: openMaturity,
      onOpenIncidents: openIncidents,
    }) as any[]

    expect(columns).toHaveLength(3)
    expect(columns.map((column) => column.headerName)).toEqual(['Maturity', 'Vectors', 'Incidents'])
    expect(columns.map((column) => column.field || column.colId)).toEqual(['status', 'vectors', 'linked_rcas'])
    expect(columns.map((column) => column.width)).toEqual([164, 160, 144])
    expect(columns.map((column) => column.minWidth)).toEqual([152, 140, 136])
    expect(columns.every((column) => column.operationalSkipAutoSize === true)).toBe(true)
    expect(columns.every((column) => column.suppressAutoSize === true)).toBe(true)
    expect(columns.every((column) => column.resizable === true)).toBe(true)
    expect(columns.every((column) => column.cellClass === OPERATIONAL_GRID_CLASSES.centeredCell)).toBe(true)
    expect(columns.every((column) => column.headerClass === OPERATIONAL_GRID_CLASSES.centeredHeader)).toBe(true)
    expect(columns[0].filter).toBe('agTextColumnFilter')
    expect(columns[0].hide).toBe(true)
    expect(columns[1].hide).toBe(true)
    expect(columns[2].hide).toBe(true)
    expect(columns.map((column) => column.minWidth)).toEqual([152, 140, 136])
  })

  it('preserves maturity and incident activation callbacks', () => {
    const openMaturity = vi.fn()
    const openIncidents = vi.fn()
    const [maturityColumn, , incidentColumn] = createFarAnalyticalColumns({
      fontSize: 11,
      hiddenColumns: [],
      onOpenMaturity: openMaturity,
      onOpenIncidents: openIncidents,
    }) as any[]

    const maturityCell = maturityColumn.cellRenderer({ data: { mitigations: [monitoring] } }) as any
    maturityCell.props.children.props.onClick()
    expect(openMaturity).toHaveBeenCalledTimes(1)

    const incidents = [{ id: 12, title: 'Power event' }]
    const incidentCell = incidentColumn.cellRenderer({ data: { linked_rcas: incidents } }) as any
    expect(incidentCell.type).toBe(OperationalLinkedCountCell)
    incidentCell.props.onActivate(incidents)
    expect(openIncidents).toHaveBeenCalledWith(incidents)
  })

  it('wires the full FAR source to the builders without leaving handwritten analytical column blocks', () => {
    const source = readFileSync('src/components/FAR.tsx', 'utf8')
    expect(source).toContain('(c.field || c.colId) && !c.lockVisible')
    expect(source).toContain('key={col.field || col.colId}')
    expect(source).toContain('hiddenColumns.includes(col.field || col.colId)')
    expect(source).toContain('{col.headerName || col.field || col.colId}')
    expect(source).toContain("from './FAR.gridColumns'")
    expect(source).toContain('...createFarAnalyticalColumns({')
    expect(source).toContain('const lv = getFarMaturityLevel(mode)')
    expect(source).toContain('FAR_MATURITY_LEVELS.slice().reverse()')
    expect(source).not.toContain('const getMaturity = (mode: any) =>')
    expect(source).not.toContain('headerName: "Maturity"')
    expect(source).not.toContain('colId: "vectors"')

    const syntax = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: 'FAR.tsx',
      reportDiagnostics: true,
    })
    const errors = (syntax.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    expect(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([])
  })
})
