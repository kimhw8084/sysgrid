import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import * as ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import {
  OperationalLinkedCountCell,
  createOperationalGoldenTextColumn,
  createOperationalMetricBadgeColumn,
  getOperationalContentAwareWidth,
  getOperationalHeaderSafeMinWidth,
} from './OperationalGoldenColumns'

const syntaxErrors = (source: string, fileName: string) => {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
    reportDiagnostics: true,
  })
  return (result.diagnostics || [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

describe('operational golden grid cell contract', () => {
  it('derives a deterministic header-safe minimum without shrinking accepted minima', () => {
    expect(getOperationalHeaderSafeMinWidth({ headerName: 'S', minWidth: 68 })).toBe(68)
    expect(getOperationalHeaderSafeMinWidth({ headerName: 'Incidents', minWidth: 112 })).toBe(112)

    const longHeader = 'Operational Escalation Ownership'
    const derived = getOperationalHeaderSafeMinWidth({ headerName: longHeader, minWidth: 96 })
    expect(derived).toBe(48 + longHeader.length * 7)
    expect(derived).toBeGreaterThan(96)
  })

  it('applies the header-safe floor across content-aware, text, and metric golden columns', () => {
    const longHeader = 'Operational Escalation Ownership'
    const safe = getOperationalHeaderSafeMinWidth({ headerName: longHeader, minWidth: 96 })

    expect(getOperationalContentAwareWidth({
      headerName: longHeader,
      values: ['Short'],
      minWidth: 96,
      fallbackWidth: 100,
      maxDefaultWidth: 360,
    })).toBeGreaterThanOrEqual(safe)

    expect(createOperationalGoldenTextColumn({
      field: 'owner',
      headerName: longHeader,
      width: 300,
      minWidth: 96,
    }).minWidth).toBe(safe)

    expect(createOperationalMetricBadgeColumn({
      field: 'score',
      headerName: longHeader,
      width: 300,
      minWidth: 96,
      fontSize: 11,
      resolveTone: () => 'neutral',
    }).minWidth).toBe(safe)
  })

  it('generalizes linked-count activation and hover disclosure without domain semantics', () => {
    const items = [
      { id: 11, title: 'Power event' },
      { id: 12, title: 'Timeout' },
    ]
    const activate = vi.fn()
    const element = OperationalLinkedCountCell({
      items,
      fontSize: 11,
      previewTitle: 'Linked records',
      getItemKey: (item) => item.id,
      getItemLabel: (item) => item.title,
      getToneClass: (count) => `tone-${count}`,
      onActivate: activate,
    }) as any

    const group = element.props.children
    const button = group.props.children
    button.props.onClick()
    expect(activate).toHaveBeenCalledWith(items)
    expect(activate.mock.calls[0][0]).not.toBe(items)

    const html = renderToStaticMarkup(element)
    expect(html).toContain('tone-2')
    expect(html).toContain('Linked records')
    expect(html).toContain('Power event')
    expect(html).toContain('Timeout')

    const emptyHtml = renderToStaticMarkup(OperationalLinkedCountCell({
      items: [],
      fontSize: 11,
      emptyLabel: 'None',
      previewTitle: 'Linked records',
      getItemKey: (_item, index) => index,
      getItemLabel: (item: any) => item,
      getToneClass: () => 'tone-0',
      onActivate: vi.fn(),
    }))
    expect(emptyHtml).toContain('None')
    expect(emptyHtml).not.toContain('Linked records')
  })

  it('keeps the shared and FAR analytical sources syntactically valid and FAR-specific hover markup removed', () => {
    const golden = readFileSync('src/components/shared/OperationalGoldenColumns.tsx', 'utf8')
    const farGrid = readFileSync('src/components/FAR.gridColumns.tsx', 'utf8')

    expect(farGrid).toContain("from './shared/OperationalGoldenColumns'")
    expect(farGrid).toContain('<OperationalLinkedCountCell')
    expect(farGrid).toContain('getOperationalHeaderSafeMinWidth({ headerName, minWidth })')
    expect(farGrid).not.toContain('pointer-events-none absolute bottom-full')

    const errors = [
      ...syntaxErrors(golden, 'OperationalGoldenColumns.tsx'),
      ...syntaxErrors(farGrid, 'FAR.gridColumns.tsx'),
    ]
    expect(errors).toEqual([])
  })
})
