export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Box extends Point, Size {}

export interface Sample extends Point {
  t: number;
}

interface StepBase {
  caption?: string;
}

interface Zoomable {
  /** `true` for the script's zoom scale, or a scale. */
  zoom?: true | number;
  /** Other elements to keep in frame while zoomed, measured while recording. */
  keepInView?: string[];
}

export type Step = StepBase &
  (
    | { action: "goto"; url: string }
    | ({ action: "click"; target: string } & Zoomable)
    | ({ action: "hover"; target: string } & Zoomable)
    | ({ action: "type"; target: string; text: string; delayMs?: number } & Zoomable)
    | ({ action: "select"; target: string; option: string } & Zoomable)
    | { action: "zoom-in"; target: string; scale?: number; keepInView?: string[] }
    | { action: "zoom-out" }
    | { action: "press"; key: string }
    | ({ action: "scroll" } & ({ y: number } | { target: string }))
    | { action: "wait-for"; target: string }
    | { action: "wait"; ms: number }
    | { action: "pause-recording" }
    | { action: "resume-recording" }
    | { action: "switch"; screen: string; transition?: Transition }
    | ({ action: "save"; as: string } & ({ target: string; attribute?: string } | { from: "url" | "clipboard" }))
  );

export const TRANSITIONS = ["fade", "slide"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export const FRAMES = ["browser-safari", "browser-chrome", "mobile-iphone", "none"] as const;
export type FrameKind = (typeof FRAMES)[number];

export interface ScreenOptions {
  url: string;
  frame?: FrameKind;
  /** Browser frames and `none` only; phone frames use the device's screen size. */
  viewport?: Size;
}

export interface Script {
  /** The page to record when the script has no `screens`. */
  url?: string;
  /** Named screens, each its own isolated browser page. The first one is on camera at the start. */
  screens?: Record<string, ScreenOptions>;
  viewport?: Size;
  deviceScaleFactor?: number;
  /** The scale of `zoom: true` steps. */
  zoom?: number;
  /** How long the camera stays zoomed after a step ends. */
  zoomHoldMs?: number;
  output?: Partial<Size> & { path?: string; fps?: number };
  style?: {
    background?: string;
    padding?: number;
    radius?: number;
    shadow?: number;
    motionBlur?: number;
    cursor?: { size?: number; travelMs?: number };
    captions?: { fontSize?: number };
  };
  steps: Step[];
}

export interface Frame {
  file: string;
  t: number;
}

export interface StepLog {
  index: number;
  screen: string;
  start: number;
  end: number;
  actionAt?: number;
  point?: Point;
  caret?: Sample[];
  inputBox?: Box;
  shotBox?: Box;
  menu?: Menu;
}

/** A native `<select>`'s menu, which the browser doesn't draw into the recording, so the render draws it. Page coordinates. */
export interface Menu {
  box: Box;
  rowHeight: number;
  fontSize: number;
  /** The rows shown: a long list shows only the part around the chosen option. */
  options: string[];
  /** Drawn like iPhone Safari's menu instead of a desktop one. */
  ios: boolean;
  /** Rows (in `options`) checked before and after the pick, or -1 when not shown. */
  from: number;
  to: number;
  openAt: number;
  closeAt: number;
}

export interface ScreenRecording {
  frame: FrameKind;
  viewport: Size;
  /** Paths relative to the `frames` folder. */
  frames: Frame[];
  /** Pointer positions. On touch screens it jumps from tap to tap. */
  cursor: Sample[];
  clicks: number[];
  urls: { t: number; url: string }[];
}

/** A change from one screen to another: the transition runs from `start` to `end`. */
export interface Switch {
  /** Index of the `switch` step. On resuming a paused recording, the last switch while paused. */
  step: number;
  /** When the switch (or pause) step began; the screen being left zooms out from here. */
  leave: number;
  start: number;
  end: number;
  from: string;
  to: string;
  /**
   * Draw the outgoing screen (`from`) at its last frame before `start` for the whole transition.
   * Set when the switch happens on resuming a paused recording: that screen kept changing off camera while paused.
   */
  freezeOutgoing?: boolean;
}

export interface Recording {
  key: string;
  duration: number;
  firstScreen: string;
  screens: Record<string, ScreenRecording>;
  switches: Switch[];
  steps: StepLog[];
  vars: Record<string, string>;
}
