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
    // An open mobile drawer owns focus until it closes. Moving focus to the
    // route body during the same navigation transition would strand keyboard
    // users outside the visible navigation surface.
    if (document.querySelector('[data-sg-app-sidebar][data-sg-nav-open="true"]')) return
    mainContentRef.current?.focus({ preventScroll: true })
  }, [location.pathname, mainContentRef])
}
