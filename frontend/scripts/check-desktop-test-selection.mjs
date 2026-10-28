import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

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
for (const file of new Set(specs.map(spec => spec.file))) {
  const source = readFileSync(path.join('tests', file), 'utf8')
  assert(!/\b(?:fs\.)?(?:rm|rmSync|rmdir|unlink|unlinkSync)\s*\(/.test(source), `Unsafe file deletion in ${file}`)
  assert(!/process\.cwd\s*\(/.test(source), `Unscoped working-directory output in ${file}`)
}
const names = specs.map(spec => spec.title)
const families = ['visual foundation', 'rack reference', 'audit reference', 'settings reference', 'settings history', 'history reference', 'saved theme']
for (const family of families) {
  for (const theme of ['pure-clarity', 'nordic-frost-v1']) {
    assert(names.some(name => name.startsWith(`${family} ${theme}`)), `Missing ${family} ${theme}`)
  }
}
for (const theme of ['pure-clarity', 'nordic-frost-v1']) {
  for (const scenario of ['initial load', 'fallback recovery', 'stale edit', 'command recovery']) {
    assert(names.includes(`desktop Asset ${scenario} ${theme}`), `Missing Asset ${scenario} ${theme}`)
  }
  assert(names.includes(`desktop release identity ${theme}`), `Missing desktop release identity ${theme}`)
  for (const family of ['configured asset choices', 'configured choices recover without replacing drafts', 'singleton Map labels']) {
    assert(names.includes(`desktop ${family} ${theme}`), `Missing desktop ${family} ${theme}`)
  }
  assert(names.includes(`desktop form guide keyboard ${theme}`), `Missing desktop guide keyboard ${theme}`)
  for (const width of [1024, 1280, 1440, 1920]) {
    assert(names.includes(`desktop Report and Map ${theme} ${width}`), `Missing desktop Report/Map ${theme} ${width}`)
    assert(names.includes(`visual foundation ${theme} ${width}`), `Missing ${theme} ${width} desktop foundation`)
  }
  for (const surface of ['assets', 'network', 'service-detail', 'monitoring-detail']) {
    assert(names.includes(`saved theme ${theme} controls ${surface} independently of OS appearance`), `Missing theme consumer ${theme} ${surface}`)
  }
}
assert(names.every(name => !/\b(?:320|390|740)(?:px|x\d+)?\b|\b(?:phone|mobile|narrow[- ]screen)\b/i.test(name)), 'Phone qualification is deferred in this additional desktop gate')
assert(specs.every(spec => spec.tests.length > 0 && spec.tests.every(test => test.expectedStatus === 'passed')), 'Every selected desktop case must execute without expected skips/failures')
console.log(JSON.stringify({ selected: names.length, names }, null, 2))
console.log('Desktop qualification selection: PASS')
