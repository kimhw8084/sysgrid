type TestResponseInit = ResponseInit & {
  redirected?: boolean
  finalUrl?: string
}

export function makeTestResponse(body: BodyInit | null, init: TestResponseInit = {}): Response {
  const { redirected, finalUrl, ...responseInit } = init
  const raw = new Response(body, responseInit)
  const response = {
    ok: raw.ok,
    status: raw.status,
    statusText: raw.statusText,
    headers: raw.headers,
    redirected: Boolean(redirected),
    url: finalUrl || 'https://api.example.com/response',
    async text() {
      return raw.clone().text()
    },
    async json() {
      return raw.clone().json()
    },
    async blob() {
      const bytes = await raw.clone().arrayBuffer()
      const BlobConstructor = typeof window !== 'undefined' ? window.Blob : Blob
      return new BlobConstructor([bytes], { type: raw.headers.get('content-type') || '' })
    },
    clone() {
      return makeTestResponse(body, init)
    },
  }
  return response as Response
}

export function makeJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('Content-Type', 'application/json')
  return makeTestResponse(JSON.stringify(body), {
    ...init,
    headers,
  })
}
