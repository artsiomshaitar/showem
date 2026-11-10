import { expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { frameOn } from "../src/camera.ts";
import { addPixels, averagePixels, fillsView } from "../src/frames.ts";
import { layout } from "../src/layout.ts";
import { MAIN, makeScript, VIEWPORT } from "./fixtures.ts";

const l = layout(makeScript(), MAIN);

test("the backdrop is skipped only when the zoomed window covers the whole frame", () => {
  expect(fillsView(l, frameOn(l, VIEWPORT, 1, { x: 720, y: 450 }), l.width, l.height)).toBe(false);
  expect(fillsView(l, frameOn(l, VIEWPORT, 1.3, { x: 0, y: 0 }), l.width, l.height)).toBe(false);
  expect(fillsView(l, frameOn(l, VIEWPORT, 2, { x: 720, y: 450 }), l.width, l.height)).toBe(true);
});

test("motion blur averages sub-frames exactly, so a dark page keeps its color", () => {
  const frame = new Uint8ClampedArray([18, 18, 20, 255]);
  const sum = new Uint16Array(4);
  for (let k = 0; k < 10; k++) addPixels(sum, frame);
  const out = averagePixels(sum, 10, createCanvas(1, 1).getContext("2d").createImageData(1, 1));
  expect([...out.data]).toEqual([18, 18, 20, 255]);
});

test("motion blur rounds the average to the nearest value", () => {
  const sum = new Uint16Array(4);
  addPixels(sum, new Uint8ClampedArray([0, 1, 254, 255]));
  addPixels(sum, new Uint8ClampedArray([255, 2, 255, 255]));
  const out = averagePixels(sum, 2, createCanvas(1, 1).getContext("2d").createImageData(1, 1));
  expect([...out.data]).toEqual([128, 2, 255, 255]);
});
