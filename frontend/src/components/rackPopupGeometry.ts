import { computeFloatingPanelRect } from './shared/OperationalGridInteractions'

export type RackPopupPoint = { x: number; y: number }

export type RackPopupViewport = { width: number; height: number }

const EDGE = 16
const FUNCTION_MENU_WIDTH = 216
const FUNCTION_MENU_HEIGHT = 220
const IMPACT_PANEL_WIDTH = 450
const IMPACT_PANEL_HEIGHT = 520
const PANEL_GAP = 12

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

/** Place impact analysis beside the rack-unit action menu, with a fixed 12px gap. */
export function getRackImpactPopupLayout(point: RackPopupPoint, viewport: RackPopupViewport) {
  const menu = computeFloatingPanelRect({
    x: point.x,
    y: point.y,
    preferredWidth: FUNCTION_MENU_WIDTH,
    preferredHeight: FUNCTION_MENU_HEIGHT,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  })
  const menuWidth = menu.width
  const menuHeight = menu.maxHeight
  const panelWidth = Math.min(IMPACT_PANEL_WIDTH, Math.max(0, viewport.width - EDGE * 2))
  const menuLeft = menu.left
  const menuTop = menu.top ?? viewport.height - (menu.bottom ?? EDGE) - menuHeight
  const rightX = menuLeft + menuWidth + PANEL_GAP
  const leftX = menuLeft - PANEL_GAP - panelWidth
  const maxX = Math.max(EDGE, viewport.width - panelWidth - EDGE)

  if (rightX + panelWidth <= viewport.width - EDGE || leftX >= EDGE) {
    const x = rightX + panelWidth <= viewport.width - EDGE ? rightX : leftX
    const maxHeight = Math.max(0, viewport.height - EDGE * 2)
    const height = Math.min(IMPACT_PANEL_HEIGHT, maxHeight)
    const y = clamp(menuTop, EDGE, Math.max(EDGE, viewport.height - EDGE - height))
    return { x, y, width: panelWidth, maxHeight: Math.max(0, viewport.height - y - EDGE) }
  }

  // When there is not enough horizontal room, stack the analysis next to the
  // menu vertically. Shrink its scrollable height to the available gap so it
  // never covers the menu or jumps to the opposite edge of the page.
  const belowMenu = menuTop + menuHeight + PANEL_GAP
  const belowSpace = Math.max(0, viewport.height - EDGE - belowMenu)
  const aboveSpace = Math.max(0, menuTop - PANEL_GAP - EDGE)
  const maxHeight = Math.min(IMPACT_PANEL_HEIGHT, Math.max(belowSpace, aboveSpace))
  const placeBelow = belowSpace >= aboveSpace
  const y = placeBelow ? belowMenu : menuTop - PANEL_GAP - maxHeight
  const x = clamp(menuLeft, EDGE, maxX)
  return { x, y: clamp(y, EDGE, Math.max(EDGE, viewport.height - EDGE - maxHeight)), width: panelWidth, maxHeight }
}

export function getRackImpactPopupPosition(point: RackPopupPoint, viewport: RackPopupViewport) {
  const { x, y, width } = getRackImpactPopupLayout(point, viewport)
  return { x, y, width }
}
