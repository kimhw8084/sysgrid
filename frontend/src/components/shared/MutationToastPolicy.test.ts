import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as ts from 'typescript'

const sourceRoot = path.resolve(process.cwd(), 'src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name) ? [file] : []
  })
}

function mutationErrorsWithLocalToast(source: string, fileName: string): boolean {
  // Avoid building a TypeScript AST for files that cannot match the policy.
  // The AST predicate below requires these exact identifiers in the source.
  if (!source.includes('useMutation')) return false
  if (!source.includes('onError')) return false
  if (!source.includes('showWorkspaceToast')
    && !source.includes('showOperationalBulkErrorToast')
    && !source.includes('toast')) return false

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  let missingOwnership = false

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)
      && node.expression.getText(sourceFile).endsWith('useMutation')
      && node.arguments[0]
      && ts.isObjectLiteralExpression(node.arguments[0])) {
      const options = node.arguments[0]
      const onError = options.properties.find(property => (
        ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'onError'
      ))
      const meta = options.properties.find((property): property is ts.PropertyAssignment => (
        ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'meta'
      ))
      if (onError && ts.isPropertyAssignment(onError)) {
        let ownsToast = false
        const findToast = (child: ts.Node) => {
          if (ts.isCallExpression(child)) {
            const expression = child.expression
            const name = ts.isIdentifier(expression)
              ? expression.text
              : ts.isPropertyAccessExpression(expression) ? expression.name.text : ''
            if (name === 'showWorkspaceToast' || name === 'showOperationalBulkErrorToast'
              || (ts.isPropertyAccessExpression(expression)
                && expression.expression.getText(sourceFile) === 'toast'
                && ['error', 'custom'].includes(expression.name.text))) {
              ownsToast = true
            }
          }
          ts.forEachChild(child, findToast)
        }
        findToast(onError.initializer)
        if (ownsToast && !(meta && meta.initializer.getText(sourceFile).includes('handlesErrorToast'))) {
          missingOwnership = true
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return missingOwnership
}

describe('mutation toast ownership', () => {
  it('marks local error-toast handlers so the global cache does not show a duplicate', () => {
    const unmarked = sourceFiles(sourceRoot).filter(file => (
      mutationErrorsWithLocalToast(readFileSync(file, 'utf8'), file)
    )).map(file => path.relative(sourceRoot, file))

    expect(unmarked).toEqual([])
  })
})
