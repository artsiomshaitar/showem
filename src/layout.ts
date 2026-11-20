import { FRAME_SPECS } from "./device.ts";
import { hiddenSteps, outputOf, shownCaption, styleOf } from "./script.ts";
import type { Box, FrameKind, Script, Size } from "./types.ts";

export interface Layout extends Size {
  frame: FrameKind;
  /** Canvas pixels per page pixel when the camera is not zoomed. */
  fit: number;
  /** Space kept around the window, in canvas pixels. */
  padding: number;
  /** Height of what is drawn above the page: toolbar or status bar. */
  toolbar: number;
  /** The whole browser window or phone. */
  window: Box;
  radius: number;
  /** The part of the window that shows content: toolbar and page. Same as `window` without a bezel. */
  screen: Box;
  screenRadius: number;
  page: Box;
  /**
   * The top of a one-line caption, in canvas pixels, or the canvas height when the script has no captions.
   * Zoomed shots are framed in the part above it, so what a step does never happens behind its caption.
   */
  captionTop: number;
}

/** Whether any caption shows in the video. */
function hasCaptions(script: Script) {
  const hidden = hiddenSteps(script);
  return script.steps.some((s, i) => !hidden.has(i) && s.caption && shownCaption(script, s.caption));
}

/** Caption text size in canvas pixels. */
export const captionSize = (script: Script) => styleOf(script).captionSize ?? Math.round(outputOf(script).height * 0.03);

/** Space between the bottom of a caption and the bottom of the video. */
export const captionGap = (height: number, padding: number) => (padding + height * 0.04) / 2;

/** Height of a caption box with `lines` lines of text. */
export const captionHeight = (fontSize: number, lines: number) => lines * fontSize * 1.3 + fontSize;

export function layout(script: Script, screen: { frame: FrameKind; viewport: Size }): Layout {
  const { width, height } = outputOf(script);
  const style = styleOf(script);
  const spec = FRAME_SPECS[screen.frame];
  const { viewport } = screen;
  const pad = style.padding * height;
  const fit = Math.min(
    (width - 2 * pad) / (viewport.width + 2 * spec.bezel),
    (height - 2 * pad) / (viewport.height + spec.top + 2 * spec.bezel),
  );
  const bezel = spec.bezel * fit;
  const toolbar = spec.top * fit;
  const pageWidth = viewport.width * fit;
  const pageHeight = viewport.height * fit;
  const x = (width - pageWidth) / 2;
  const y = (height - pageHeight - toolbar) / 2;
  const windowRadius = style.radius * height;
  return {
    width,
    height,
    frame: screen.frame,
    fit,
    padding: pad,
    toolbar,
    window: { x: x - bezel, y: y - bezel, width: pageWidth + 2 * bezel, height: pageHeight + toolbar + 2 * bezel },
    radius: spec.radius === undefined ? windowRadius : spec.radius * fit,
    screen: { x, y, width: pageWidth, height: pageHeight + toolbar },
    screenRadius: spec.screenRadius === undefined ? windowRadius : spec.screenRadius * fit,
    page: { x, y: y + toolbar, width: pageWidth, height: pageHeight },
    captionTop: hasCaptions(script) ? height - captionGap(height, pad) - captionHeight(captionSize(script), 1) : height,
  };
}
