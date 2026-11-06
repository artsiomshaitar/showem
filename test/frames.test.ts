import { expect, test } from "bun:test";
import { frameOn } from "../src/camera.ts";
import { fillsView } from "../src/frames.ts";
import { layout } from "../src/layout.ts";
import { MAIN, makeScript, VIEWPORT } from "./fixtures.ts";

const l = layout(makeScript(), MAIN);

test("the backdrop is skipped only when the zoomed window covers the whole frame", () => {
  expect(fillsView(l, frameOn(l, VIEWPORT, 1, { x: 720, y: 450 }), l.width, l.height)).toBe(false);
  expect(fillsView(l, frameOn(l, VIEWPORT, 1.3, { x: 0, y: 0 }), l.width, l.height)).toBe(false);
  expect(fillsView(l, frameOn(l, VIEWPORT, 2, { x: 720, y: 450 }), l.width, l.height)).toBe(true);
});
