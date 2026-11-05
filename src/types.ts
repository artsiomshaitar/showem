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
  );

export interface Script {
  url: string;
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
  start: number;
  end: number;
  actionAt?: number;
  point?: Point;
  caret?: Sample[];
  inputBox?: Box;
  shotBox?: Box;
}

export interface Recording {
  stepsKey: string;
  viewport: Size;
  duration: number;
  frames: Frame[];
  cursor: Sample[];
  clicks: number[];
  steps: StepLog[];
  urls: { t: number; url: string }[];
}
