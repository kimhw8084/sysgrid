import type { RefObject } from 'react'
import { useEffect } from 'react'

export type RouteFocusLocation = {
  pathname: string
  search?: string
}

export const useRouteFocus = (
  location: RouteFocusLocation,
  mainContentRef: RefObject<HTMLElement | null>,
) => {
  useEffect(() => {
    mainContentRef.current?.focus({ preventScroll: true })
  }, [location.pathname, mainContentRef])
}
