import { clamp } from "./geometry.ts";
import type { Box, Point, Size } from "./types.ts";

const MAX_ROWS = 10;
const PAD = 4;
const GAP = 4;
const ROW_SCALE = 1.6;
/** iPhone Safari's select menu, in CSS pixels: fixed row height, text size and width, kept this far from the screen edges. */
const IOS = { rowHeight: 44, fontSize: 17, width: 250, margin: 8 };

/**
 * Where a native select's menu opens: below the select, or above it when there is no room below.
 * On a desktop it's as wide as the select and uses its text size; on an iPhone (`ios`) it's Safari's narrower menu with taller rows.
 */
export function menuLayout(select: Box, options: readonly string[], selected: number, chosen: number, selectFontSize: number, viewport: Size, ios = false) {
  const rows = Math.min(options.length, MAX_ROWS);
  const first = clamp(chosen - Math.floor(rows / 2), 0, options.length - rows);
  const fontSize = ios ? IOS.fontSize : selectFontSize;
  const rowHeight = ios ? IOS.rowHeight : Math.round(fontSize * ROW_SCALE);
  const width = ios ? Math.min(IOS.width, viewport.width - 2 * IOS.margin) : select.width;
  const x = ios ? clamp(select.x, IOS.margin, viewport.width - IOS.margin - width) : select.x;
  const height = rows * rowHeight + 2 * PAD;
  const below = select.y + select.height + GAP;
  const y = below + height <= viewport.height || select.y - GAP - height < 0 ? below : select.y - GAP - height;
  const inView = (i: number) => (i >= first && i < first + rows ? i - first : -1);
  return {
    box: { x, y, width, height },
    rowHeight,
    fontSize,
    ios,
    options: options.slice(first, first + rows),
    from: inView(selected),
    to: inView(chosen),
  };
}

export function rowBox(menu: { box: Box; rowHeight: number }, row: number): Box {
  return { x: menu.box.x + PAD, y: menu.box.y + PAD + row * menu.rowHeight, width: menu.box.width - 2 * PAD, height: menu.rowHeight };
}

export function rowAt(menu: { box: Box; rowHeight: number; options: readonly string[] }, p: Point): number {
  const { box } = menu;
  if (p.x < box.x || p.x > box.x + box.width) return -1;
  const row = Math.floor((p.y - box.y - PAD) / menu.rowHeight);
  return row >= 0 && row < menu.options.length ? row : -1;
}
