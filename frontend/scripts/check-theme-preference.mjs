import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'

const configPath = path.resolve(process.argv[2] || 'tailwind.config.js')
const { default: config } = await import(pathToFileURL(configPath).href)
const result = await postcss([tailwindcss({
  ...config,
  content: [{ raw: '<span class="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-500/5"></span>', extension: 'html' }],
})]).process('@tailwind utilities;', { from: undefined })

const darkRules = []
result.root.walkRules(rule => {
  if (!rule.selector.includes('dark\\:')) return
  let osScheme = false
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && /prefers-color-scheme/.test(parent.params || '')) osScheme = true
  }
  darkRules.push({ selector: rule.selector, osScheme, properties: rule.nodes.filter(node => node.type === 'decl').map(node => node.prop) })
})
console.log(JSON.stringify({ config: path.basename(configPath), darkRules }, null, 2))
assert.equal(darkRules.length, 2, 'Both real StatusPill dark variants must be emitted')
for (const rule of darkRules) {
  assert.equal(rule.osScheme, false, 'Saved app appearance cannot be overridden by OS color scheme')
  assert.match(rule.selector, /\.dark(?:\s|\))/, 'Dark utilities must be selected by the application theme class')
}
console.log('Saved theme CSS contract: PASS')
