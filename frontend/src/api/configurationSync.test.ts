import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startConfigurationSync } from './configurationSync'

class Socket {
  static current: Socket
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor() { Socket.current = this }
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('configuration convergence', () => {
  it.each(['healthy', 'failed', 'closed', 'cross-origin', 'constructor failure'])('polls with %s transport and stops on disposal', async mode => {
    if (mode === 'constructor failure') vi.stubGlobal('WebSocket', class { constructor() { throw new Error('blocked') } })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const stop = startConfigurationSync(refresh, mode === 'cross-origin' ? null : 'ws://localhost/api/v1/ws/sync')
    if (mode === 'failed') Socket.current.onerror?.()
    if (mode === 'closed') Socket.current.close()
    await vi.advanceTimersByTimeAsync(59_999)
    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('serializes socket and periodic refresh, then recovers a failed refresh', async () => {
    let finish!: () => void
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const stop = startConfigurationSync(refresh, 'ws://localhost/api/v1/ws/sync')
    Socket.current.onmessage?.({ data: 'unrelated' })
    expect(refresh).not.toHaveBeenCalled()
    Socket.current.onmessage?.({ data: 'CONFIG_UPDATED' })
    await vi.advanceTimersByTimeAsync(60_000)
    Socket.current.onmessage?.({ data: 'CONFIG_UPDATED' })
    expect(refresh).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(refresh).toHaveBeenCalledTimes(3)
    stop()
    Socket.current.onmessage?.({ data: 'CONFIG_UPDATED' })
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(Socket.current.close).toHaveBeenCalledTimes(1)
  })
})
