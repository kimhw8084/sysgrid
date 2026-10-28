import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const report = JSON.parse(execFileSync(process.execPath, [
  'node_modules/@playwright/test/cli.js', 'test', '--config=playwright.role-matrix.config.ts', '--list', '--reporter=json',
], { encoding: 'utf8', env: { ...process.env, SYSGRID_DESKTOP_ONLY: '1', SYSGRID_VERIFY_PROFILE: 'role-matrix' } }))
assert.deepEqual(report.errors, [])
const specs = []
function collect(suite) {
  specs.push(...(suite.specs || []))
  for (const child of suite.suites || []) collect(child)
}
for (const suite of report.suites) collect(suite)
const expected = ['isolated viewer identity receives its real asset permissions', 'isolated editor identity receives its real asset permissions']
for (const module of ['services', 'monitoring', 'network', 'vendors', 'external', 'far', 'research', 'knowledge']) {
  expected.push(`viewer cannot create in ${module}`, `editor can access create in ${module}`)
}
assert.deepEqual(specs.map(spec => spec.title).sort(), expected.sort(), 'Role qualification inventory differs')
assert(specs.every(spec => spec.tests.length === 1 && spec.tests.every(test => test.expectedStatus === 'passed')), 'Role qualification must not contain expected skips')
console.log(JSON.stringify({ selected: specs.length }))
console.log('Role matrix selection: PASS')
