import http from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { expect, request as requestFactory, test } from '@playwright/test'
import { createTestApiClient } from './helpers/test-api-client'
import { testApiHeaders } from './helpers/sysgrid'

async function withServer(handler: http.RequestListener, run: (url: string) => Promise<void>) {
  const server = http.createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

test('setup client avoids a deterministically rejected reused socket without retrying', async () => {
  const requestsPerSocket = new Map<Socket, number>()
  let requests = 0
  await withServer((req, res) => {
    requests++
    const count = (requestsPerSocket.get(req.socket) || 0) + 1
    requestsPerSocket.set(req.socket, count)
    if (count > 1) return req.socket.resetAndDestroy()
    res.end('ok')
  }, async url => {
    const raw = await requestFactory.newContext()
    const isolated = await requestFactory.newContext()
    try {
      expect((await raw.get(url)).status()).toBe(200)
      await expect(raw.get(url)).rejects.toThrow(/ECONNRESET|socket hang up/)
      const client = createTestApiClient(isolated)
      expect((await client.get(url)).status()).toBe(200)
      expect((await client.get(url)).status()).toBe(200)
      expect(requests).toBe(4)
      expect([...requestsPerSocket.values()].sort()).toEqual([1, 1, 2])
    } finally {
      await raw.dispose()
      await isolated.dispose()
    }
  })
})

for (const method of ['get', 'post', 'patch', 'delete', 'put'] as const) {
  test(`setup client exposes a fresh ${method.toUpperCase()} connection reset after exactly one request`, async () => {
    let requests = 0
    await withServer((req) => {
      requests++
      // A mutation may already have happened before its response connection is lost.
      req.socket.resetAndDestroy()
    }, async url => {
      const context = await requestFactory.newContext()
      try {
        await expect(createTestApiClient(context)[method](url)).rejects.toThrow(/ECONNRESET|socket hang up/)
        expect(requests).toBe(1)
      } finally { await context.dispose() }
    })
  })
}

test('setup client preserves HTTP 500 and does not replay a failed mutation', async () => {
  let writes = 0
  await withServer((_req, res) => {
    writes++
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ detail: 'Controlled server failure' }))
  }, async url => {
    const context = await requestFactory.newContext()
    try {
      const response = await createTestApiClient(context).post(url, { data: { name: 'transport fixture' } })
      expect(response.status()).toBe(500)
      expect(await response.json()).toEqual({ detail: 'Controlled server failure' })
      expect(writes).toBe(1)
    } finally { await context.dispose() }
  })
})

test('setup client preserves actor, tenant, body and caller options without changing browser headers', async ({}, testInfo) => {
  let requests = 0
  await withServer(async (req, res) => {
    requests++
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ actor: req.headers['x-user-id'], tenant: req.headers['x-tenant-id'], marker: req.headers['x-test-marker'],
      connection: req.headers.connection, method: req.method, body: Buffer.concat(chunks).toString() }))
  }, async url => {
    const context = await requestFactory.newContext()
    try {
      const client = createTestApiClient(context)
      const defaultResponse = await client.get(url)
      expect(await defaultResponse.json()).toMatchObject({ actor: testApiHeaders['X-User-Id'], tenant: testApiHeaders['X-Tenant-Id'], connection: 'close' })
      const response = await client.put(url, { headers: { 'X-User-Id': 'transport-actor', 'X-Tenant-Id': '83', 'X-Test-Marker': 'preserved', connection: 'keep-alive' },
        data: { name: 'preserved payload' }, failOnStatusCode: true })
      expect(await response.json()).toEqual({ actor: 'transport-actor', tenant: '83', marker: 'preserved', connection: 'close', method: 'PUT', body: '{"name":"preserved payload"}' })
      expect(requests).toBe(2)
      expect(Object.keys(testInfo.project.use.extraHTTPHeaders || {}).some(key => key.toLowerCase() === 'connection')).toBe(false)
    } finally { await context.dispose() }
  })
})
