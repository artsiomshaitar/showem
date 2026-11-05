import type { Point } from "./types.ts";

const MIN_TRAVEL_MS = 250;
const TRAVEL_MS_PER_PX = 0.8;
const MAX_BEND = 80;

export const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export function travelMs(from: Point, to: Point, maxMs: number) {
  return Math.min(maxMs, MIN_TRAVEL_MS + Math.hypot(to.x - from.x, to.y - from.y) * TRAVEL_MS_PER_PX);
}

/** A slightly curved, eased path from `from` to `to`, as a function of progress 0..1. */
export function cursorPath(from: Point, to: Point): (k: number) => Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const bend = Math.min(dist * 0.15, MAX_BEND);
  const nx = (-dy / dist) * bend;
  const ny = (dx / dist) * bend;
  const c1 = { x: from.x + dx / 3 + nx, y: from.y + dy / 3 + ny };
  const c2 = { x: from.x + (dx * 2) / 3 + nx / 2, y: from.y + (dy * 2) / 3 + ny / 2 };
  return (k) => {
    const e = easeInOutCubic(k);
    const u = 1 - e;
    return {
      x: u * u * u * from.x + 3 * u * u * e * c1.x + 3 * u * e * e * c2.x + e * e * e * to.x,
      y: u * u * u * from.y + 3 * u * u * e * c1.y + 3 * u * e * e * c2.y + e * e * e * to.y,
    };
  };
}
