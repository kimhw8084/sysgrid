// Static JSX/route discovery only. Runtime-generated actions still need review.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.argv[2]
if (!output) throw new Error('An explicit, new JSON artifact path is required')
const entries = []
const files = []
function scan(directory) {
  for (const child of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, child.name)
    if (child.isDirectory()) scan(full)
    else if (/\.tsx$/.test(child.name) && !/\.(test|spec)\.tsx$/.test(child.name)) files.push(full)
  }
}
scan(path.join(root, 'frontend/src'))
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  if (source.parseDiagnostics.length) throw new Error(`Cannot parse ${file}`)
  const routeTags = new Set()
  const iconTags = new Set()
  for (const statement of source.statements.filter(ts.isImportDeclaration)) {
    const module = statement.moduleSpecifier.text
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const binding of bindings.elements) {
      if (module === 'react-router-dom' && (binding.propertyName?.text || binding.name.text) === 'Route') routeTags.add(binding.name.text)
      if (module === 'lucide-react') iconTags.add(binding.name.text)
    }
  }
  function walk(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source)
      const attributes = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute)
        .map(attribute => [attribute.name.getText(source), attribute.initializer?.getText(source) ?? 'true']))
      const events = Object.keys(attributes).filter(name => /^on[A-Z]/.test(name))
      const route = routeTags.has(tag)
      const overlay = !iconTags.has(tag) && (/Modal|Dialog|Drawer|Popover|Menu|Sheet/.test(tag) || /dialog|menu/.test(attributes.role || ''))
      const control = /^(button|input|select|textarea|a)$/.test(tag) || /Button|Link$/.test(tag) || events.length > 0
      if (route || overlay || control) {
        let owner = node.parent
        while (owner && !((ts.isFunctionDeclaration(owner) || ts.isVariableDeclaration(owner)) && owner.name)) owner = owner.parent
        const position = source.getLineAndCharacterOfPosition(node.getStart(source))
        const filePath = path.relative(root, file)
        entries.push({ id: `${filePath}:${position.line + 1}:${position.character + 1}`, file: filePath,
          line: position.line + 1, owner: owner?.name?.getText(source) || filePath, tag,
          kind: route ? 'route' : overlay ? 'overlay' : 'control',
          declaration: Object.fromEntries(Object.entries(attributes).filter(([name]) =>
            ['path', 'role', 'aria-label', 'aria-labelledby', 'title', 'name', 'type', 'moduleId', 'disabled', 'isOpen', 'to', ...events].includes(name))
            .map(([name, value]) => [name, value.slice(0, 250)])),
          status: 'requires_qualification' })
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
}
const inventory = { schema_version: 1, kind: 'static_ui_acceptance_inventory',
  source_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scanned_files: files.length,
  source_files: Object.fromEntries(files.map(file => [path.relative(root, file), createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),
  limitations: ['Static declarations can include preserved legacy or unreachable controls.',
    'Runtime-generated menus, grid actions, conditional states and accessibility require rendered review.',
    'Source locations identify implementation owners; no entry is automatically accepted.'], entries }
fs.writeFileSync(output, JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ files: files.length, entries: entries.length, output }))
