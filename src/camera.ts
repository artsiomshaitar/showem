import { center, clamp, keepInside, lerp } from "./geometry.ts";
import type { Layout } from "./layout.ts";
import { DEFAULT_ZOOM, fillVars, zoomOf } from "./script.ts";
import { itemAt } from "./timeline.ts";
import type { Box, Point, Recording, Sample, Script, Size } from "./types.ts";

/** `cx`, `cy`: the point of the page (as a fraction of its size) shown at the center of the frame. */
export interface Camera {
  scale: number;
  cx: number;
  cy: number;
}

export interface Shot {
  scale: number;
  point: Point;
  /** Where to look while typing, over time. */
  focus?: Sample[];
  /** The input being typed into; the view stays inside it when it can. */
  bounds?: Box;
  /** When the camera starts moving to this shot, if it is the first of a chain. */
  on: number;
  /** When this shot takes over from the previous one in a chain. */
  start: number;
  actionAt: number;
  off: number;
}

export interface Chain {
  shots: Shot[];
  on: number;
  off: number;
}

const LEAD_MS = 900;
const CHAIN_GAP_MS = 1200;
const SHOT_MARGIN = 40;
const SAMPLE_MS = 1000 / 240;
const SPRING_STIFFNESS = 11;
const SMOOTHING_S = 0.015;

/**
 * The caret where typing starts, then one focus point per typed word, at the middle of the word, from when the caret
 * reaches it. The recording already knows where each word ends, so the camera can head there while it is being typed.
 */
export function wordFocus(caret: readonly Sample[], text: string): Sample[] {
  const first = caret[0];
  if (!first) return [];
  const out: Sample[] = [first];
  let wordStart = first;
  const chars = [...text];
  chars.forEach((ch, i) => {
    const before = caret[i];
    const after = caret[i + 1];
    if (!before || !after) return;
    const space = /\s/.test(ch);
    if (!space && i < chars.length - 1) return;
    const end = space ? before : after;
    if (end.x > wordStart.x) out.push({ t: wordStart.t, x: (wordStart.x + end.x) / 2, y: (wordStart.y + end.y) / 2 });
    wordStart = after;
  });
  return out;
}

/** The step's zoom, lowered if needed so that `box` (plus a margin) fits in the frame. */
export function fitScale(scale: number, box: Box, layout: Layout) {
  const fitsWidth = layout.width / (layout.fit * (box.width + 2 * SHOT_MARGIN));
  const fitsHeight = layout.height / (layout.fit * (box.height + 2 * SHOT_MARGIN));
  return Math.max(1, Math.min(scale, fitsWidth, fitsHeight));
}

/** When a step's zoom can end: after the step, and after the key presses right after it, which go to the element it focused. */
function zoomEnd(script: Script, rec: Recording, at: number) {
  const { screen } = rec.steps[at]!;
  let end = rec.steps[at]!.end;
  for (const log of rec.steps.slice(at + 1)) {
    if (log.screen !== screen || script.steps[log.index]?.action !== "press") break;
    end = log.end;
  }
  return end;
}

function buildShots(script: Script, rec: Recording, screen: string, layout: Layout, navigations: readonly number[]): Shot[] {
  // A zoom never starts before the page it frames has loaded, or before the switch to this screen has settled.
  const settled = rec.switches.filter((s) => s.to === screen).map((s) => rec.steps.find((l) => l.index === s.step)?.end ?? s.end);
  const cuts = [...navigations, ...settled].sort((a, b) => a - b);
  return rec.steps.flatMap((log, at) => {
    const step = log.screen === screen ? script.steps[log.index] : undefined;
    const zoom = step && zoomOf(script, step);
    const { point, actionAt, shotBox } = log;
    if (!zoom || !point || actionAt === undefined) return [];
    const nextNavigation = navigations.find((t) => t > actionAt) ?? Infinity;
    return [{
      scale: shotBox ? fitScale(zoom.scale, shotBox, layout) : zoom.scale,
      point: shotBox ? center(shotBox) : point,
      focus: log.caret && step.action === "type" ? wordFocus(log.caret, fillVars(step.text, rec.vars)) : undefined,
      bounds: log.inputBox,
      on: Math.max(actionAt - LEAD_MS, cuts.findLast((t) => t <= actionAt) ?? -Infinity),
      start: log.start,
      actionAt,
      off: Math.min(zoomEnd(script, rec, at) + zoom.holdMs, nextNavigation),
    }];
  });
}

/** Whether `box` shows in a camera centered on `at` at `scale`. */
function inFrame(box: Box, at: Point, scale: number, layout: Layout) {
  const halfWidth = layout.width / (2 * scale * layout.fit) - SHOT_MARGIN;
  const halfHeight = layout.height / (2 * scale * layout.fit) - SHOT_MARGIN;
  return Math.abs(box.x - at.x) <= halfWidth && Math.abs(box.x + box.width - at.x) <= halfWidth && Math.abs(box.y - at.y) <= halfHeight && Math.abs(box.y + box.height - at.y) <= halfHeight;
}

/**
 * Shots for each `zoom-in`: it frames its element until a `zoom-out`, a page change or a switch away.
 * A pointer step inside it that the frame doesn't show moves the camera there, at the same scale.
 */
function regionShots(script: Script, rec: Recording, screen: string, layout: Layout, navigations: readonly number[]): Shot[] {
  return rec.steps.flatMap((log, at) => {
    const step = script.steps[log.index];
    if (log.screen !== screen || step?.action !== "zoom-in" || !log.shotBox || log.actionAt === undefined) return [];
    const { shotBox, actionAt } = log;
    const closedAt = rec.steps.slice(at + 1).find((l) => l.screen === screen && ["zoom-out", "goto", "zoom-in"].includes(script.steps[l.index]!.action));
    const off = Math.min(closedAt ? (closedAt.actionAt ?? closedAt.start) : rec.duration, navigations.find((t) => t > actionAt) ?? Infinity);
    const scale = fitScale(step.scale ?? script.zoom ?? DEFAULT_ZOOM, shotBox, layout);
    const home = center(shotBox);
    const region: Shot = { scale, point: home, on: actionAt, start: log.start, actionAt, off };
    let looking = home;
    const follows = rec.steps.flatMap((inner): Shot[] => {
      if (inner.screen !== screen || !inner.point || inner.actionAt === undefined || inner.actionAt <= actionAt || inner.actionAt >= off) return [];
      if (zoomOf(script, script.steps[inner.index]!)) return [];
      const box = inner.shotBox ?? { ...inner.point, width: 0, height: 0 };
      if (inFrame(box, looking, scale, layout)) return [];
      looking = inner.shotBox ? center(inner.shotBox) : inner.point;
      return [{ scale: inner.shotBox ? fitScale(scale, inner.shotBox, layout) : scale, point: looking, on: inner.start, start: inner.start, actionAt: inner.actionAt, off }];
    });
    return [region, ...follows];
  });
}

/** Joins shots that are close in time into one continuous shot, except across a page navigation. */
export function chainShots(shots: readonly Shot[], navigations: readonly number[]): Chain[] {
  const chains: Chain[] = [];
  let current: Chain | undefined;
  let prev: Shot | undefined;
  for (const shot of shots) {
    const after = prev?.actionAt ?? -Infinity;
    const navigated = navigations.some((t) => t > after && t <= shot.actionAt);
    // Measured from when the step starts: a step with a caption waits for it to be read, and that pause isn't a gap.
    if (current && prev && !navigated && Math.min(shot.on, shot.start) - current.off <= CHAIN_GAP_MS) {
      current.shots.push(shot);
      current.off = Math.max(current.off, shot.off);
    } else {
      current = { shots: [shot], on: shot.on, off: shot.off };
      chains.push(current);
    }
    prev = shot;
  }
  return chains;
}

/** A camera looking at `focus` (page pixels), kept inside `bounds` when given and inside the canvas. */
export function frameOn(layout: Layout, viewport: Size, scale: number, focus: Point, bounds?: Box): Camera {
  const halfWidth = layout.width / (2 * scale * layout.fit);
  const halfHeight = layout.height / (2 * scale * layout.fit);
  const x = bounds ? keepInside(focus.x, bounds.x, bounds.x + bounds.width, halfWidth) : focus.x;
  const y = bounds ? keepInside(focus.y, bounds.y, bounds.y + bounds.height, halfHeight) : focus.y;
  const { page, fit } = layout;
  return {
    scale,
    cx: clamp(x, (halfWidth * fit - page.x) / fit, (layout.width - halfWidth * fit - page.x) / fit) / viewport.width,
    cy: clamp(y, (halfHeight * fit - page.y) / fit, (layout.height - halfHeight * fit - page.y) / fit) / viewport.height,
  };
}

class Spring {
  private filtered: number;
  private velocity = 0;

  constructor(public value: number) {
    this.filtered = value;
  }

  step(goal: number, dt: number, smoothing: number) {
    this.filtered += (goal - this.filtered) * smoothing;
    this.velocity += (SPRING_STIFFNESS ** 2 * (this.filtered - this.value) - 2 * SPRING_STIFFNESS * this.velocity) * dt;
    this.value += this.velocity * dt;
  }
}

/** Follows `target` with a critically damped spring (zoom is smoothed in log space), sampled ahead of time. */
function smoothCamera(target: (t: number) => Camera, durationMs: number): (t: number) => Camera {
  const dt = SAMPLE_MS / 1000;
  const smoothing = 1 - Math.exp(-dt / SMOOTHING_S);
  const startAt = target(0);
  const springs = [new Spring(Math.log(startAt.scale)), new Spring(startAt.cx), new Spring(startAt.cy)] as const;
  const samples: Camera[] = [];
  for (let t = 0; t <= durationMs + SAMPLE_MS; t += SAMPLE_MS) {
    const goal = target(t);
    springs[0].step(Math.log(goal.scale), dt, smoothing);
    springs[1].step(goal.cx, dt, smoothing);
    springs[2].step(goal.cy, dt, smoothing);
    samples.push({ scale: Math.exp(springs[0].value), cx: springs[1].value, cy: springs[2].value });
  }
  return (t) => {
    const f = clamp(t / SAMPLE_MS, 0, samples.length - 1);
    const i = Math.floor(f);
    const a = samples[i] ?? startAt;
    const b = samples[i + 1] ?? a;
    const k = f - i;
    return { scale: lerp(a.scale, b.scale, k), cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k) };
  };
}

/**
 * The camera of one screen. Switching screens counts as a navigation for both of them,
 * so each screen is seen zoomed out right after a switch.
 */
export function buildCamera(script: Script, rec: Recording, screen: string, layout: Layout): (t: number) => Camera {
  const { viewport, urls } = rec.screens[screen]!;
  const navigations = [...urls.slice(1).map((u) => u.t), ...rec.switches.map((s) => s.leave)].sort((a, b) => a - b);
  const shots = [...buildShots(script, rec, screen, layout, navigations), ...regionShots(script, rec, screen, layout, navigations)].sort((a, b) => a.actionAt - b.actionAt);
  const chains = chainShots(shots, navigations);
  const wide = frameOn(layout, viewport, 1, { x: viewport.width / 2, y: viewport.height / 2 });

  const target = (t: number): Camera => {
    const chain = chains.find((c) => t >= c.on && t < c.off);
    const started = chain?.shots.filter((s, i) => t >= (i === 0 ? chain.on : s.start)) ?? [];
    // The latest shot still running; between shots, the last one holds. So a zoomed step inside a zoom-in hands back to it when done.
    const shot = started.findLast((s) => t < s.off) ?? started.at(-1);
    if (!shot) return wide;
    const focus = (shot.focus && itemAt(shot.focus, t)) ?? shot.point;
    return frameOn(layout, viewport, shot.scale, focus, shot.focus && shot.bounds);
  };
  return smoothCamera(target, rec.duration);
}
