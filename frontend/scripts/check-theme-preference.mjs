import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import postcss from 'postcss'

const assetsDirectory = path.resolve('dist/assets')
const cssFiles = (await readdir(assetsDirectory))
  .filter(file => file.endsWith('.css'))
  .sort()
assert(cssFiles.length > 0, 'Build the production frontend before checking emitted theme CSS')

const expectedDarkVariants = [
  { token: 'dark\\:text-emerald-400', property: 'color' },
  { token: 'dark\\:bg-emerald-500\\/5', property: 'background-color' },
]
const darkRules = []

for (const file of cssFiles) {
  const stylesheet = postcss.parse(await readFile(path.join(assetsDirectory, file), 'utf8'), { from: file })
  stylesheet.walkRules(rule => {
    if (!rule.selector.includes('dark\\:')) return
    let osScheme = false
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && /prefers-color-scheme/.test(parent.params || '')) osScheme = true
    }
    darkRules.push({ file, selector: rule.selector, osScheme, properties: rule.nodes.filter(node => node.type === 'decl').map(node => node.prop) })
  })
}

const checkedRules = []
for (const variant of expectedDarkVariants) {
  const rules = darkRules.filter(rule => rule.selector.includes(variant.token) && rule.properties.includes(variant.property))
  assert(rules.length > 0, `Production CSS must emit ${variant.token} with ${variant.property}`)
  for (const rule of rules) {
    assert.equal(rule.osScheme, false, 'Saved app appearance cannot be overridden by OS color scheme')
    assert.match(rule.selector, /\.dark(?:\s|\)|\*)/, 'Dark utilities must be selected by the application theme class')
  }
  checkedRules.push(...rules)
}
console.log(JSON.stringify({ cssFiles, checkedDarkRules: checkedRules }, null, 2))
console.log('Saved theme CSS contract: PASS')
