import { OperationalRowActionSectionModel, OperationalRowActionItem } from "./OperationalRowActionMenu";

const CHAR_WIDTH = 8;
const ICON_WIDTH = 14;
const SECTION_GAP = 8;
const SECTION_HORIZONTAL_PADDING = 12;
const MIN_PANEL_WIDTH = 224;
const MAX_PANEL_WIDTH = 520;
const MIN_ACTION_CONTENT_WIDTH = 200;

const HEADER_HEIGHT = 70;
const SECTION_TITLE_HEIGHT = 20;
const BUTTON_HEIGHT = 36;
const BODY_PADDING = 12;
const DIVIDER_HEIGHT = 1;

export function estimateRowActionButtonWidth(label: string, confirmLabel?: string, confirming?: boolean): number {
  const text = confirming ? (confirmLabel || "Confirm?") : label;
  const estimatedLabelWidth = text.length * CHAR_WIDTH;
  return SECTION_HORIZONTAL_PADDING * 2 + ICON_WIDTH + SECTION_GAP + estimatedLabelWidth;
}

export function computeRowActionGeometry({
  sections,
  headerContentWidth = 0,
  viewportWidth,
  viewportHeight,
  cursorX,
  cursorY,
  edge = 16,
  gap = SECTION_GAP,
  panelPadding = SECTION_HORIZONTAL_PADDING,
  measuredHeight
}: {
  sections: OperationalRowActionSectionModel[];
  headerContentWidth?: number;
  viewportWidth: number;
  viewportHeight: number;
  cursorX: number;
  cursorY: number;
  edge?: number;
  gap?: number;
  panelPadding?: number;
  measuredHeight?: number | null;
}) {
  const POINT_MENU_CURSOR_GAP = 8;
  const viewportSafeWidth = Math.max(0, viewportWidth - edge * 2);
  const maxPanelWidth = Math.min(MAX_PANEL_WIDTH, viewportSafeWidth);
  const contentSafeWidth = Math.max(0, maxPanelWidth - panelPadding * 2);

  const processedSections = sections.map((section) => {
    const maxColumns = Math.max(1, Math.min(section.columns ?? 2, 5));
    const rows: { items: OperationalRowActionItem[], buttonWidths: number[], rowWidth: number, allowWrap: boolean }[] = [];
    let currentRowItems: OperationalRowActionItem[] = [];
    let currentRowButtonWidths: number[] = [];
    let currentRowWidth = 0;

    const pushRow = (allowWrap = false) => {
      if (currentRowItems.length === 0) return;
      rows.push({ items: currentRowItems, buttonWidths: currentRowButtonWidths, rowWidth: currentRowWidth, allowWrap });
      currentRowItems = [];
      currentRowButtonWidths = [];
      currentRowWidth = 0;
    };

    section.items.forEach((item) => {
      const estimatedWidth = estimateRowActionButtonWidth(item.label, item.confirmLabel, item.confirming);
      const buttonWidth = Math.min(estimatedWidth, contentSafeWidth);
      const isConstrained = estimatedWidth >= contentSafeWidth;
      const nextRowWidth = currentRowWidth + (currentRowItems.length > 0 ? gap : 0) + buttonWidth;

      if (currentRowItems.length > 0 && (
        currentRowItems.length >= maxColumns ||
        nextRowWidth > contentSafeWidth ||
        isConstrained
      )) pushRow();

      if (currentRowItems.length > 0) currentRowWidth += gap;
      currentRowItems.push(item);
      currentRowButtonWidths.push(buttonWidth);
      currentRowWidth += buttonWidth;
      if (isConstrained) pushRow(true);
    });
    pushRow();

    return { id: section.id, showTitle: section.id !== "archive", items: section.items, rows };
  });

  const widestActionRow = Math.max(0, ...processedSections.flatMap(section => section.rows.map(row => row.rowWidth)));
  const actionSetWidth = Math.min(contentSafeWidth, Math.max(MIN_ACTION_CONTENT_WIDTH, widestActionRow));
  const minimumContentWidth = Math.max(actionSetWidth, Math.min(headerContentWidth, contentSafeWidth));
  const panelWidth = Math.min(
    maxPanelWidth,
    Math.max(Math.min(MIN_PANEL_WIDTH, viewportSafeWidth), minimumContentWidth + panelPadding * 2),
  );

  let panelHeight = HEADER_HEIGHT + BODY_PADDING * 2;
  processedSections.forEach((section, idx) => {
    if (section.showTitle) panelHeight += SECTION_TITLE_HEIGHT;
    panelHeight += section.rows.length * BUTTON_HEIGHT + Math.max(0, section.rows.length - 1) * gap;
    if (idx < processedSections.length - 1) panelHeight += SECTION_GAP + DIVIDER_HEIGHT;
  });

  const finalPanelHeight = measuredHeight ?? panelHeight;
  const belowSpace = viewportHeight - edge - (cursorY + POINT_MENU_CURSOR_GAP);
  const aboveSpace = cursorY - POINT_MENU_CURSOR_GAP - edge;

  let placement: "below" | "above" = "below";
  let top: number | undefined;
  let bottom: number | undefined;
  let maxHeight: number;

  if (finalPanelHeight <= belowSpace) {
    placement = "below";
    top = cursorY + POINT_MENU_CURSOR_GAP;
    maxHeight = finalPanelHeight;
  } else if (finalPanelHeight <= aboveSpace) {
    placement = "above";
    bottom = viewportHeight - cursorY + POINT_MENU_CURSOR_GAP;
    maxHeight = finalPanelHeight;
  } else if (belowSpace >= aboveSpace) {
    placement = "below";
    top = cursorY + POINT_MENU_CURSOR_GAP;
    maxHeight = Math.max(0, belowSpace);
  } else {
    placement = "above";
    bottom = viewportHeight - cursorY + POINT_MENU_CURSOR_GAP;
    maxHeight = Math.max(0, aboveSpace);
  }

  return {
    panelWidth,
    panelHeight: finalPanelHeight,
    placement,
    style: {
      left: Math.max(edge, Math.min(cursorX, viewportWidth - panelWidth - edge)),
      top,
      bottom,
      width: panelWidth,
      maxHeight,
    },
    sections: processedSections,
    actionSetWidth,
  };
}
