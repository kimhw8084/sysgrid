// WebSocket notifications accelerate refresh but are process-local on the server.
// Poll even with a healthy socket so another worker's updates eventually converge.
export function startConfigurationSync(refresh: () => Promise<unknown>, socketUrl: string | null) {
  let stopped = false
  let refreshing = false
  let socket: WebSocket | null = null
  const sync = async () => {
    if (stopped || refreshing) return
    refreshing = true
    try { await refresh() } catch { /* A later poll can recover transient unavailability. */ }
    finally { refreshing = false }
  }
  const interval = window.setInterval(sync, 60_000)
  if (socketUrl) {
    try {
      socket = new WebSocket(socketUrl)
      socket.onmessage = event => { if (event.data === 'CONFIG_UPDATED') void sync() }
      // HTTP refresh remains active after a failed or cleanly closed socket.
      socket.onerror = () => {}
    } catch { /* HTTP refresh also covers a rejected socket constructor. */ }
  }
  return () => {
    stopped = true
    window.clearInterval(interval)
    socket?.close()
  }
}
