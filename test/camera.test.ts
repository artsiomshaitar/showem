import { describe, expect, test } from "bun:test";
import { buildCamera, chainShots, fitScale, frameOn, wordFocus, type Shot } from "../src/camera.ts";
import { layout } from "../src/layout.ts";
import type { Step } from "../src/types.ts";
import { MAIN, makeRecording, makeScript, VIEWPORT } from "./fixtures.ts";

const l = layout(makeScript(), MAIN);

describe("wordFocus", () => {
  test("adds a point at the middle of each finished word", () => {
    const caret = [0, 10, 20, 30, 40, 50, 60].map((x, i) => ({ t: i * 100, x: 100 + x, y: 50 }));
    const focus = wordFocus(caret, "ab cde");
    expect(focus.map((f) => f.x)).toEqual([100, 110, 145]);
    expect(focus.map((f) => f.t)).toEqual([0, 300, 600]);
  });

  test("is empty without caret samples", () => {
    expect(wordFocus([], "abc")).toEqual([]);
  });
});

describe("fitScale", () => {
  test("keeps the step's zoom when the box fits", () => {
    expect(fitScale(1.8, { x: 0, y: 0, width: 200, height: 100 }, l)).toBe(1.8);
  });

  test("zooms out just enough for a wide box, but never below 1", () => {
    const scale = fitScale(1.8, { x: 0, y: 0, width: 1100, height: 100 }, l);
    expect(scale).toBeLessThan(1.8);
    expect(scale).toBeGreaterThan(1);
    expect(fitScale(1.8, { x: 0, y: 0, width: 5000, height: 100 }, l)).toBe(1);
  });
});

describe("chainShots", () => {
  const shot = (on: number, off: number, actionAt = on + 900): Shot => ({ scale: 2, point: { x: 0, y: 0 }, on, start: on, actionAt, off });

  test("joins shots that are close in time", () => {
    const chains = chainShots([shot(0, 1000), shot(1500, 2500)], []);
    expect(chains).toHaveLength(1);
    expect(chains[0]?.off).toBe(2500);
  });

  test("splits shots far apart in time", () => {
    expect(chainShots([shot(0, 1000), shot(5000, 6000)], [])).toHaveLength(2);
  });

  test("splits shots across a page navigation", () => {
    expect(chainShots([shot(0, 1000), shot(1500, 2500)], [1200])).toHaveLength(2);
  });
});

describe("frameOn", () => {
  test("at 1× it shows the whole window, whatever the focus", () => {
    const cam = frameOn(l, VIEWPORT, 1, { x: 0, y: 0 });
    expect(cam.cx).toBeCloseTo(0.5);
    expect(cam.cy).toBeLessThan(0.5);
  });

  test("zoomed in, it centers on the focus", () => {
    const cam = frameOn(l, VIEWPORT, 2, { x: 720, y: 450 });
    expect(cam.cx).toBeCloseTo(0.5);
    expect(cam.cy).toBeCloseTo(0.5);
  });

  test("zoomed in, it never pans past the edge of the frame", () => {
    const corner = frameOn(l, VIEWPORT, 2, { x: 0, y: 0 });
    const inside = frameOn(l, VIEWPORT, 2, { x: 300, y: 200 });
    expect(corner.cx).toBeGreaterThan(0);
    expect(corner.cx).toBeLessThan(inside.cx);
  });

  test("while typing, it stays inside the input when the input is wider than the view", () => {
    const input = { x: 100, y: 400, width: 1200, height: 40 };
    const cam = frameOn(l, VIEWPORT, 3, { x: 120, y: 420 }, input);
    const halfView = l.width / (2 * 3 * l.fit) / VIEWPORT.width;
    expect(cam.cx - halfView).toBeCloseTo(input.x / VIEWPORT.width);
  });
});

describe("buildCamera", () => {
  const steps: Step[] = [{ action: "click", target: "#a", zoom: 2 }];
  const script = makeScript({ steps });
  const log = { index: 0, screen: "main", start: 1000, actionAt: 1500, end: 2000, point: { x: 720, y: 450 } };

  test("starts wide, is zoomed in at the click, and zooms back out", () => {
    const camera = buildCamera(script, makeRecording(script, { steps: [log] }), "main", l);
    expect(camera(0).scale).toBeCloseTo(1);
    expect(camera(1500).scale).toBeGreaterThan(1.9);
    expect(camera(3900).scale).toBeLessThan(1.05);
  });

  test("zooms out as soon as the page navigates", () => {
    const stay = buildCamera(script, makeRecording(script, { steps: [log] }), "main", l);
    const navigate = buildCamera(script, makeRecording(script, { steps: [log] }, { urls: [{ t: 0, url: "a" }, { t: 1700, url: "b" }] }), "main", l);
    expect(stay(2200).scale).toBeGreaterThan(1.9);
    expect(navigate(2200).scale).toBeLessThan(1.3);
  });

  test("zooms out as soon as the video switches to another screen", () => {
    const switched = makeRecording(script, { steps: [log], switches: [{ step: 1, leave: 1700, start: 1800, end: 2400, from: "main", to: "other" }] });
    expect(buildCamera(script, switched, "main", l)(2200).scale).toBeLessThan(1.3);
  });

  test("waits for the switch to this screen to settle before zooming in", () => {
    const switchLog = { index: 1, screen: "main", start: 600, end: 1300 };
    const arrived = makeRecording(script, { steps: [switchLog, log], switches: [{ step: 1, leave: 500, start: 600, end: 1000, from: "other", to: "main" }] });
    expect(buildCamera(script, arrived, "main", l)(1300).scale).toBeLessThan(1.05);
  });

  test("does not zoom in before the page it frames has loaded", () => {
    const loaded = makeRecording(script, { steps: [log] }, { urls: [{ t: 0, url: "a" }, { t: 1200, url: "b" }] });
    expect(buildCamera(script, loaded, "main", l)(1200).scale).toBeLessThan(1.05);
  });

  test("moves smoothly, without jumps between samples", () => {
    const camera = buildCamera(script, makeRecording(script, { steps: [log] }), "main", l);
    for (let t = 0; t < 4000; t += 1000 / 60) {
      expect(Math.abs(camera(t + 1000 / 60).scale - camera(t).scale)).toBeLessThan(0.1);
    }
  });
});
