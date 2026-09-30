import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolveConfig, version } from 'vite'

// Resolve the real application config without opening a listening socket.
const config = await resolveConfig({ mode: 'development' }, 'serve')
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
const [major, minor, patch] = version.split('.').map(Number)
assert(major === 6 && minor === 4 && patch >= 3, 'Use the reviewed security-patched Vite 6.4 line')
assert.equal(lock.packages['node_modules/vite'].version, version, 'Installed Vite must match the committed lock')
assert.equal(manifest.scripts.dev, 'vite', 'The default npm command must not override the safe bind address')
assert.equal(config.server.host, '127.0.0.1', 'Default development server must bind only to loopback')
assert.deepEqual(config.server.allowedHosts, [], 'Default hostname checks must remain enabled')
assert.equal(config.server.fs.strict, true, 'Retain filesystem access checks')
console.log(JSON.stringify({ vite: version, host: config.server.host, allowedHosts: config.server.allowedHosts, fsStrict: config.server.fs.strict }))
console.log('Development server boundary: PASS')
