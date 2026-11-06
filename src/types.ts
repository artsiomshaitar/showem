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

export interface ZoomOptions {
  scale?: number;
  holdMs?: number;
  include?: string[];
}

export type Zoom = boolean | number | ZoomOptions;

interface StepBase {
  caption?: string;
}

export type Step = StepBase &
  (
    | { action: "goto"; url: string }
    | { action: "click"; target: string; zoom?: Zoom }
    | { action: "hover"; target: string; zoom?: Zoom }
    | { action: "type"; target: string; text: string; delayMs?: number; zoom?: Zoom }
    | { action: "press"; key: string }
    | { action: "scroll"; y: number }
    | { action: "waitFor"; target: string }
    | { action: "pause"; ms: number }
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
  /** Index of the `switch` step. */
  step: number;
  /** When the switch step began; the screen being left zooms out from here. */
  leave: number;
  start: number;
  end: number;
  from: string;
  to: string;
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
