import React, { useEffect, useRef, useState } from 'react'
import './ProjectsVisualRepair.css'

/** Shell navigation stays lightweight: importing it must not import the Gantt workspace. */
export function useProjectsNavigation(pathname: string, expanded: boolean) {
  const active = pathname === '/projects' || pathname.startsWith('/projects/')
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth)
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { let raf = 0; const update = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setWidth(window.innerWidth)) }; window.addEventListener('resize', update); return () => { window.removeEventListener('resize', update); cancelAnimationFrame(raf) } }, [])
  const mobile = width < 768
  useEffect(() => { setOpen(false) }, [pathname])
  const close = () => { setOpen(false); requestAnimationFrame(() => toggleRef.current?.focus()) }
  useEffect(() => {
    if (!mobile || !open) return
    const aside = document.querySelector<HTMLElement>('[data-sg-app-sidebar]')
    const main = document.querySelector<HTMLElement>('[data-sg-app-main]')
    const wasInert = main?.inert
    if (main) main.inert = true
    const controls = () => Array.from(aside?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)') || []).filter(x => x.getClientRects().length)
    controls()[0]?.focus()
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key !== 'Tab') return
      const all = controls(), index = all.indexOf(document.activeElement as HTMLElement)
      if (!all.length) return
      if (event.shiftKey && index <= 0) { event.preventDefault(); all[all.length - 1].focus() }
      else if (!event.shiftKey && index === all.length - 1) { event.preventDefault(); all[0].focus() }
    }
    document.addEventListener('keydown', keys)
    return () => { document.removeEventListener('keydown', keys); if (main) main.inert = wasInert || false }
  }, [mobile, open])
  // Projects uses the same persisted desktop navigation preference as every
  // other route. A project-specific 1440px breakpoint made the global sidebar
  // unexpectedly collapse and shifted the whole workspace on narrower laptops.
  const sidebarExpanded = mobile ? open : expanded
  return { active, mobile, open, sidebarExpanded, toggleRef, close, toggle: () => setOpen(value => !value) }
}

export function ProjectsNavigationButton({ nav }: { nav: ReturnType<typeof useProjectsNavigation> }) {
  return nav.mobile ? <button ref={nav.toggleRef} className="sg-app-menu" onClick={nav.toggle} aria-expanded={nav.open} aria-label="Open application navigation">☰</button> : null
}

export function ProjectsNavigationBackdrop({ nav }: { nav: ReturnType<typeof useProjectsNavigation> }) {
  return nav.mobile && nav.open ? <button className="sg-nav-backdrop" aria-label="Close application navigation" onClick={nav.close}/> : null
}
