import { expect, test } from "bun:test";
import { PHONE_VIEWPORT } from "../src/device.ts";
import { layout } from "../src/layout.ts";
import { MAIN, makeScript, VIEWPORT } from "./fixtures.ts";

test("centers the window, with the page under the toolbar", () => {
  const l = layout(makeScript({ output: { width: 1920, height: 1080 } }), MAIN);
  expect(l.window.x + l.window.width / 2).toBeCloseTo(960);
  expect(l.window.y + l.window.height / 2).toBeCloseTo(540);
  expect(l.page.y).toBeCloseTo(l.window.y + l.toolbar);
  expect(l.page.y + l.page.height).toBeCloseTo(l.window.y + l.window.height);
  expect(l.page.width / l.page.height).toBeCloseTo(VIEWPORT.width / VIEWPORT.height);
});

test("keeps the padding around the window", () => {
  const l = layout(makeScript({ output: { width: 1920, height: 1080 }, style: { padding: 0.1 } }), MAIN);
  expect(l.window.y).toBeGreaterThanOrEqual(108 - 1e-9);
  expect(l.window.x).toBeGreaterThanOrEqual(108 - 1e-9);
});

test("a phone sits inside its bezel, with the status bar above the page", () => {
  const l = layout(makeScript({ output: { width: 1920, height: 1080 } }), { frame: "mobile-iphone", viewport: PHONE_VIEWPORT });
  expect(l.window.y).toBeCloseTo(1080 * 0.08);
  expect(l.window.x + l.window.width / 2).toBeCloseTo(960);
  expect(l.screen.x - l.window.x).toBeCloseTo(14 * l.fit);
  expect(l.page.y).toBeCloseTo(l.screen.y + l.toolbar);
  expect(l.screen.y + l.screen.height).toBeCloseTo(l.page.y + l.page.height);
  expect(l.radius).toBeGreaterThan(l.screenRadius);
});

test("a page without a frame has no toolbar", () => {
  const l = layout(makeScript(), { frame: "none", viewport: VIEWPORT });
  expect(l.toolbar).toBe(0);
  expect(l.page).toEqual(l.window);
});
