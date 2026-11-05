import type { Box, Point } from "./types.ts";

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export const center = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

export function union(boxes: readonly Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Moves `value` so that a span of `half` on each side stays inside [min, max]; centers it when the span does not fit. */
export function keepInside(value: number, min: number, max: number, half: number) {
  if (max - min <= 2 * half) return (min + max) / 2;
  return clamp(value, min + half, max - half);
}
