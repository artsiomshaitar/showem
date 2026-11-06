import type { FrameKind, Size } from "./types.ts";

/** Height of the iPhone status bar, drawn above the page. */
export const PHONE_STATUS_BAR = 54;
/** The iPhone 15 Pro screen (393×852) below the status bar, in CSS pixels. */
export const PHONE_VIEWPORT: Size = { width: 393, height: 852 - PHONE_STATUS_BAR };

export interface FrameSpec {
  /** What is drawn above the page (toolbar, tab strip or status bar), in page pixels. */
  top: number;
  /** Device border around the screen, in page pixels. */
  bezel: number;
  /** Corner radius of the device and of its screen, in page pixels. Browser windows use the style's radius. */
  radius?: number;
  screenRadius?: number;
}

export const FRAME_SPECS: Record<FrameKind, FrameSpec> = {
  "browser-safari": { top: 52, bezel: 0 },
  "browser-chrome": { top: 84, bezel: 0 },
  "mobile-iphone": { top: PHONE_STATUS_BAR, bezel: 14, radius: 69, screenRadius: 55 },
  none: { top: 0, bezel: 0 },
};

/** How long a finger hovers over the spot before a tap lands, so the tap can be seen coming. */
export const TAP_LEAD_MS = 180;
