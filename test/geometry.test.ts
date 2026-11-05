import { describe, expect, test } from "bun:test";
import { center, clamp, keepInside, lerp, union } from "../src/geometry.ts";

describe("union", () => {
  test("covers every box", () => {
    expect(union([{ x: 10, y: 20, width: 30, height: 10 }, { x: 0, y: 25, width: 5, height: 40 }])).toEqual({ x: 0, y: 20, width: 40, height: 45 });
  });

  test("is undefined for no boxes", () => {
    expect(union([])).toBeUndefined();
  });
});

describe("keepInside", () => {
  test("pushes the value in so the span stays inside", () => {
    expect(keepInside(0, 0, 100, 20)).toBe(20);
    expect(keepInside(95, 0, 100, 20)).toBe(80);
    expect(keepInside(50, 0, 100, 20)).toBe(50);
  });

  test("centers when the span is wider than the range", () => {
    expect(keepInside(0, 0, 100, 60)).toBe(50);
  });
});

test("small helpers", () => {
  expect(clamp(5, 0, 3)).toBe(3);
  expect(clamp(-1, 0, 3)).toBe(0);
  expect(lerp(10, 20, 0.25)).toBe(12.5);
  expect(center({ x: 10, y: 10, width: 20, height: 40 })).toEqual({ x: 20, y: 30 });
});
