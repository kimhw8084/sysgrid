import { useEffect, useRef } from 'react'

const guards = new Set<() => boolean>()
let approvedDeparture = false

export function hasUnsavedWorkspaceChanges(): boolean {
  return [...guards].some(isDirty => isDirty())
}

/** Only called after an explicit departure confirmation and a successful switch. */
export function approveWorkspaceDeparture(): void {
  approvedDeparture = true
}

export function usePageLeaveGuard(isDirty: boolean): void {
  const dirty = useRef(isDirty)
  dirty.current = isDirty
  useEffect(() => {
    const resolve = () => dirty.current
    guards.add(resolve)
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current || approvedDeparture) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      guards.delete(resolve)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])
}
