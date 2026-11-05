import { expect, test } from "bun:test";
import { layout } from "../src/layout.ts";
import { makeScript, VIEWPORT } from "./fixtures.ts";

test("centers the window, with the page under the toolbar", () => {
  const l = layout(makeScript({ output: { width: 1920, height: 1080 } }), VIEWPORT);
  expect(l.window.x + l.window.width / 2).toBeCloseTo(960);
  expect(l.window.y + l.window.height / 2).toBeCloseTo(540);
  expect(l.page.y).toBeCloseTo(l.window.y + l.toolbar);
  expect(l.page.y + l.page.height).toBeCloseTo(l.window.y + l.window.height);
  expect(l.page.width / l.page.height).toBeCloseTo(VIEWPORT.width / VIEWPORT.height);
});

test("keeps the padding around the window", () => {
  const l = layout(makeScript({ output: { width: 1920, height: 1080 }, style: { padding: 0.1 } }), VIEWPORT);
  expect(l.window.y).toBeGreaterThanOrEqual(108 - 1e-9);
  expect(l.window.x).toBeGreaterThanOrEqual(108 - 1e-9);
});
