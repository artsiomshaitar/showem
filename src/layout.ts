import { outputOf, styleOf } from "./script.ts";
import type { Box, Script, Size } from "./types.ts";

/** Height of the drawn browser toolbar, in page (CSS) pixels. */
const TOOLBAR_HEIGHT = 52;

export interface Layout extends Size {
  /** Canvas pixels per page pixel when the camera is not zoomed. */
  fit: number;
  toolbar: number;
  window: Box;
  page: Box;
}

export function layout(script: Script, viewport: Size): Layout {
  const { width, height } = outputOf(script);
  const pad = styleOf(script).padding * height;
  const fit = Math.min((width - 2 * pad) / viewport.width, (height - 2 * pad) / (viewport.height + TOOLBAR_HEIGHT));
  const pageWidth = viewport.width * fit;
  const pageHeight = viewport.height * fit;
  const toolbar = TOOLBAR_HEIGHT * fit;
  const x = (width - pageWidth) / 2;
  const y = (height - pageHeight - toolbar) / 2;
  return {
    width,
    height,
    fit,
    toolbar,
    window: { x, y, width: pageWidth, height: pageHeight + toolbar },
    page: { x, y: y + toolbar, width: pageWidth, height: pageHeight },
  };
}
