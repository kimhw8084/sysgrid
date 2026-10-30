import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Collect only. Ensure every newly released workflow is actually selected in
// the normal-user stage while its root-capability regression remains intact.
const required = JSON.parse(readFileSync('tests/qualification-suite.json', 'utf8')).release_blocking
const report = JSON.parse(execFileSync(process.execPath, [
  'node_modules/@playwright/test/cli.js', 'test', '--config=playwright.v1.config.ts', '--list', '--reporter=json',
], { encoding: 'utf8', env: { ...process.env, SYSGRID_DESKTOP_ONLY: '1', SYSGRID_VERIFY_PROFILE: 'normal-v1' } }))
assert.deepEqual(report.errors, [])
const byFile = new Map()
function collect(suite, inheritedFile = '') {
  const file = suite.file || inheritedFile
  for (const spec of suite.specs || []) {
    const name = path.basename(spec.file || file)
    const rows = byFile.get(name) || []
    rows.push(spec)
    byFile.set(name, rows)
  }
  for (const child of suite.suites || []) collect(child, file)
}
for (const suite of report.suites) collect(suite)
for (const name of required) {
  const specs = byFile.get(name) || []
  assert(specs.length > 0, `Missing normal-role release workflow ${name}`)
  assert(specs.every(spec => spec.tests.length > 0 && spec.tests.every(test => test.expectedStatus === 'passed')), `Skipped normal-role release workflow ${name}`)
}
// A release gate must not delete or overwrite fixed evidence in the checkout.
for (const file of byFile.keys()) {
  const source = readFileSync(path.join('tests', file), 'utf8')
  assert(!/\b(?:fs\.)?(?:rm|rmSync|rmdir|unlink|unlinkSync)\s*\(/.test(source), `Unsafe file deletion in ${file}`)
  assert(!/process\.cwd\s*\(/.test(source), `Unscoped working-directory output in ${file}`)
}
const matrix = (byFile.get('golden-eight-seeded-visual-matrix.spec.ts') || [])
  .filter(spec => spec.title === 'renders representative populated desktop states for every completed target view')
assert.equal(matrix.length, 1, 'Exactly one populated desktop matrix must be selected')
for (const [file, prefix] of [
  ['vendors-real-runtime.spec.ts', 'keeps default column headings readable in'],
  ['external-workflows.spec.ts', 'keeps default column headings readable in'],
  ['far-workflows.spec.ts', 'keeps RPN heading readable in'],
  ['monitoring-workflows.spec.ts', 'keeps monitoring severity heading readable in'],
  ['service-workflows.spec.ts', 'keeps services manufacturer heading readable in'],
]) {
  for (const theme of ['Dark', 'Light']) {
    assert(byFile.get(file).some(spec => spec.title === `${prefix} ${theme} theme`), `Missing ${file} ${theme} heading regression`)
  }
}
console.log(JSON.stringify({ selected: Object.fromEntries(required.map(name => [name, byFile.get(name).length])) }, null, 2))
console.log('Normal-role released workflow selection: PASS')
