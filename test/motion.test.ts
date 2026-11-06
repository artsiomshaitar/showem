import { expect, test } from "bun:test";
import { cursorPath, easeInOutCubic, springEase, travelMs } from "../src/motion.ts";

test("the cursor path starts and ends at the given points", () => {
  const path = cursorPath({ x: 0, y: 0 }, { x: 300, y: 100 });
  expect(path(0)).toEqual({ x: 0, y: 0 });
  const end = path(1);
  expect(end.x).toBeCloseTo(300);
  expect(end.y).toBeCloseTo(100);
});

test("the path bends away from the straight line", () => {
  const mid = cursorPath({ x: 0, y: 0 }, { x: 400, y: 0 })(0.5);
  expect(Math.abs(mid.y)).toBeGreaterThan(1);
});

test("easing goes from 0 to 1 without going back", () => {
  let last = 0;
  for (let k = 0; k <= 1; k += 0.05) {
    const e = easeInOutCubic(k);
    expect(e).toBeGreaterThanOrEqual(last);
    last = e;
  }
  expect(easeInOutCubic(1)).toBe(1);
});

test("travel time grows with distance, up to the limit", () => {
  const a = { x: 0, y: 0 };
  expect(travelMs(a, { x: 100, y: 0 }, 800)).toBeLessThan(travelMs(a, { x: 500, y: 0 }, 800));
  expect(travelMs(a, { x: 5000, y: 0 }, 800)).toBe(800);
});

test("the spring eases into place without overshooting", () => {
  const curve = Array.from({ length: 101 }, (_, i) => springEase(i / 100));
  expect(curve[0]).toBe(0);
  expect(curve[100]).toBe(1);
  curve.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(curve[i]!));
  expect(springEase(0.5)).toBeGreaterThan(0.9);
});
