import type { APIRequestContext } from '@playwright/test'
import { testApiHeaders } from './sysgrid'

type RequestOptions = Parameters<APIRequestContext['get']>[1]
const methods = ['get', 'post', 'patch', 'delete', 'put'] as const

// Setup/assertion traffic must not reuse a socket at the server's idle-close boundary.
// This applies only to sysApi; browser requests keep their normal connection behavior.
export function createTestApiClient(request: APIRequestContext) {
  const optionsFor = (options?: RequestOptions): RequestOptions => {
    const headers = { ...testApiHeaders, ...options?.headers }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'connection') delete headers[key]
    }
    return { ...options, headers: { ...headers, Connection: 'close' } }
  }
  return Object.fromEntries(methods.map(method => [method,
    (path: string, options?: RequestOptions) => request[method](path, optionsFor(options)),
  ])) as Record<typeof methods[number], (path: string, options?: RequestOptions) => ReturnType<APIRequestContext['get']>>
}
