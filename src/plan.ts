import { buildCamera, type Camera } from "./camera.ts";
import { lerp } from "./geometry.ts";
import { layout } from "./layout.ts";
import { stepsKey } from "./script.ts";
import { indexAt } from "./timeline.ts";
import type { Recording, Script } from "./types.ts";

export interface Caption {
  text: string;
  start: number;
  end: number;
}

export interface CursorState {
  x: number;
  y: number;
  /** Progress of the current click animation, 0..1, or 0 when not clicking. */
  press: number;
}

export interface Plan {
  camera: (t: number) => Camera;
  cursor: (t: number) => CursorState;
  captions: Caption[];
  isTyping: (t: number) => boolean;
}

const CLICK_MS = 260;

export function assertRecordingMatches(script: Script, rec: Recording) {
  if (rec.stepsKey !== stepsKey(script.steps)) {
    throw new Error("The steps changed since this was recorded. Use `opendemo run` to record again.");
  }
}

export function buildCursor(rec: Recording): (t: number) => CursorState {
  return (t) => {
    const i = Math.max(0, indexAt(rec.cursor, t));
    const a = rec.cursor[i];
    if (!a) return { x: rec.viewport.width / 2, y: rec.viewport.height / 2, press: 0 };
    const b = rec.cursor[i + 1];
    const k = b && t > a.t ? Math.min(1, (t - a.t) / (b.t - a.t)) : 0;
    const click = rec.clicks.find((c) => t >= c && t < c + CLICK_MS);
    return {
      x: b ? lerp(a.x, b.x, k) : a.x,
      y: b ? lerp(a.y, b.y, k) : a.y,
      press: click === undefined ? 0 : (t - click) / CLICK_MS,
    };
  };
}

/** Each caption shows from the start of its step until the next caption starts. */
export function buildCaptions(script: Script, rec: Recording): Caption[] {
  const marks = rec.steps.flatMap((log) => {
    const text = script.steps[log.index]?.caption;
    return text ? [{ text, start: log.start }] : [];
  });
  return marks.map((mark, i) => ({ ...mark, end: marks[i + 1]?.start ?? rec.duration }));
}

export function plan(script: Script, rec: Recording): Plan {
  const typing = rec.steps.flatMap((log) => (log.caret?.[0] ? [{ start: log.caret[0].t, end: log.end }] : []));
  return {
    camera: buildCamera(script, rec, layout(script, rec.viewport)),
    cursor: buildCursor(rec),
    captions: buildCaptions(script, rec),
    isTyping: (t) => typing.some((span) => t >= span.start && t < span.end),
  };
}
