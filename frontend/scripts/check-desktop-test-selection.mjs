import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

// Collect only; no application server or browser is started. Guard against an
// accidentally empty gate or a new whitelist dropping accepted regressions.
const report = JSON.parse(execFileSync(process.execPath, [
  'node_modules/@playwright/test/cli.js', 'test', '--config=playwright.desktop.config.ts', '--list', '--reporter=json',
], { encoding: 'utf8', env: { ...process.env, SYSGRID_DESKTOP_ONLY: '1' } }))
assert.deepEqual(report.errors, [])
const specs = []
function collect(suite) {
  specs.push(...(suite.specs || []))
  for (const child of suite.suites || []) collect(child)
}
for (const suite of report.suites) collect(suite)
const names = specs.map(spec => spec.title)
const families = ['visual foundation', 'rack reference', 'audit reference', 'settings reference', 'settings history', 'history reference', 'saved theme']
for (const family of families) {
  for (const theme of ['pure-clarity', 'nordic-frost-v1']) {
    assert(names.some(name => name.startsWith(`${family} ${theme}`)), `Missing ${family} ${theme}`)
  }
}
for (const theme of ['pure-clarity', 'nordic-frost-v1']) {
  for (const width of [1024, 1280, 1440, 1920]) {
    assert(names.includes(`visual foundation ${theme} ${width}`), `Missing ${theme} ${width} desktop foundation`)
  }
  for (const surface of ['assets', 'network', 'service-detail', 'monitoring-detail']) {
    assert(names.includes(`saved theme ${theme} controls ${surface} independently of OS appearance`), `Missing theme consumer ${theme} ${surface}`)
  }
}
assert(names.every(name => !/\b(?:320|390)\b/.test(name)), 'Phone qualification is deferred in this additional desktop gate')
assert(specs.every(spec => spec.tests.length > 0 && spec.tests.every(test => test.expectedStatus === 'passed')), 'Every selected desktop case must execute without expected skips/failures')
console.log(JSON.stringify({ selected: names.length, names }, null, 2))
console.log('Desktop qualification selection: PASS')
