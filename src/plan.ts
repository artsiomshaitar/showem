import { buildCamera, type Camera } from "./camera.ts";
import { TAP_LEAD_MS } from "./device.ts";
import { CAPTION_FADE_MS } from "./draw.ts";
import { clamp, lerp } from "./geometry.ts";
import { layout, type Layout } from "./layout.ts";
import { fillVars, hiddenSteps, isPhone, recordingKey } from "./script.ts";
import { indexAt, itemAt } from "./timeline.ts";
import type { Recording, ScreenRecording, Script, Transition } from "./types.ts";

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

export interface TapState extends CursorState {
  alpha: number;
}

export interface ScreenPlan {
  layout: Layout;
  touch: boolean;
  camera: (t: number) => Camera;
  /** Where the pointer is. On a touch screen it is the last tap and does not travel. */
  cursor: (t: number) => CursorState;
  /** The tap circle on a touch screen, while one is showing. */
  tap: (t: number) => TapState | undefined;
  isTyping: (t: number) => boolean;
}

/**
 * What is on camera: one screen, or a transition from one to another (`k` goes 0..1).
 * `direction` is 1 when going to a screen listed later in `screens` (slides to the left), -1 when going back.
 * `fromAt` is set when the outgoing screen is frozen: `from` is drawn as it was at that moment.
 */
export type Scene =
  | { screen: string }
  | { from: string; to: string; k: number; transition: Transition; direction: 1 | -1; fromAt?: number };

export interface Plan {
  screens: Record<string, ScreenPlan>;
  scene: (t: number) => Scene;
  captions: Caption[];
}

const CLICK_MS = 260;
const TAP_OUT_MS = 420;

export function assertRecordingMatches(script: Script, rec: Recording) {
  if (rec.key !== recordingKey(script)) {
    throw new Error("The screens or steps changed since this was recorded. Use `showem run` to record again.");
  }
}

export function buildCursor(screen: ScreenRecording, touch = false): (t: number) => CursorState {
  return (t) => {
    const i = Math.max(0, indexAt(screen.cursor, t));
    const a = screen.cursor[i];
    if (!a) return { x: screen.viewport.width / 2, y: screen.viewport.height / 2, press: 0 };
    const b = touch ? undefined : screen.cursor[i + 1];
    const k = b && t > a.t ? Math.min(1, (t - a.t) / (b.t - a.t)) : 0;
    const click = screen.clicks.find((c) => t >= c && t < c + CLICK_MS);
    return {
      x: b ? lerp(a.x, b.x, k) : a.x,
      y: b ? lerp(a.y, b.y, k) : a.y,
      press: click === undefined ? 0 : (t - click) / CLICK_MS,
    };
  };
}

/** A tap fades in where the finger lands, presses, then fades out. */
export function buildTap(screen: ScreenRecording): (t: number) => TapState | undefined {
  return (t) => {
    const click = screen.clicks.find((c) => t >= c - TAP_LEAD_MS && t < c + TAP_OUT_MS);
    if (click === undefined) return undefined;
    const at = itemAt(screen.cursor, click) ?? { x: 0, y: 0 };
    const alpha = clamp(Math.min((t - click + TAP_LEAD_MS) / TAP_LEAD_MS, (click + TAP_OUT_MS - t) / 200), 0, 1);
    return { x: at.x, y: at.y, alpha, press: t >= click && t < click + CLICK_MS ? (t - click) / CLICK_MS : 0 };
  };
}

/** Each caption shows from the start of its step until the next caption starts. The last one is gone before the video ends. */
export function buildCaptions(script: Script, rec: Recording): Caption[] {
  const hidden = hiddenSteps(script);
  const marks = rec.steps.flatMap((log) => {
    const text = hidden.has(log.index) ? undefined : script.steps[log.index]?.caption;
    return text ? [{ text: fillVars(text, rec.vars), start: log.start }] : [];
  });
  return marks.map((mark, i) => ({ ...mark, end: marks[i + 1]?.start ?? rec.duration - CAPTION_FADE_MS }));
}

export function sceneAt(script: Script, rec: Recording, t: number): Scene {
  const change = rec.switches.find((s) => t >= s.start && t < s.end);
  if (change) {
    const step = script.steps[change.step];
    const order = Object.keys(rec.screens);
    return {
      from: change.from,
      to: change.to,
      k: (t - change.start) / (change.end - change.start),
      transition: (step?.action === "switch" && step.transition) || "fade",
      direction: order.indexOf(change.to) > order.indexOf(change.from) ? 1 : -1,
      ...(change.freezeOutgoing && { fromAt: change.start - 0.001 }),
    };
  }
  return { screen: rec.switches.findLast((s) => s.end <= t)?.to ?? rec.firstScreen };
}

export function plan(script: Script, rec: Recording): Plan {
  const screens = Object.fromEntries(
    Object.entries(rec.screens).map(([name, screen]): [string, ScreenPlan] => {
      const touch = isPhone(screen.frame);
      const l = layout(script, screen);
      const typing = rec.steps.flatMap((log) => (log.screen === name && log.caret?.[0] ? [{ start: log.caret[0].t, end: log.end }] : []));
      return [name, {
        layout: l,
        touch,
        camera: buildCamera(script, rec, name, l),
        cursor: buildCursor(screen, touch),
        tap: buildTap(screen),
        isTyping: (t) => typing.some((span) => t >= span.start && t < span.end),
      }];
    }),
  );
  return { screens, scene: (t) => sceneAt(script, rec, t), captions: buildCaptions(script, rec) };
}
