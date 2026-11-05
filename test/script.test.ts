import { describe, expect, test } from "bun:test";
import { DEFAULT_ZOOM, outputOf, resolveScript, stepsKey, styleOf, zoomOf } from "../src/script.ts";
import type { Step } from "../src/types.ts";
import { makeScript } from "./fixtures.ts";

describe("zoomOf", () => {
  const click = (zoom: unknown) => ({ action: "click", target: "#a", zoom }) as Step;

  test("reads every zoom form", () => {
    expect(zoomOf(click(true))).toEqual({ scale: DEFAULT_ZOOM, holdMs: 300, include: [] });
    expect(zoomOf(click(2.5))?.scale).toBe(2.5);
    expect(zoomOf(click({ holdMs: 900, include: ["#b"] }))).toEqual({ scale: DEFAULT_ZOOM, holdMs: 900, include: ["#b"] });
  });

  test("treats missing, false and null as no zoom", () => {
    expect(zoomOf(click(undefined))).toBeUndefined();
    expect(zoomOf(click(false))).toBeUndefined();
    expect(zoomOf(click(null))).toBeUndefined();
    expect(zoomOf({ action: "pause", ms: 100 })).toBeUndefined();
  });
});

describe("resolveScript", () => {
  const scriptPath = "/work/demos/intro.demo.json";

  test("resolves relative paths and URLs against the script's folder", () => {
    const { script, outPath } = resolveScript(
      makeScript({
        url: "./app/index.html",
        style: { background: "bg.jpg" },
        steps: [{ action: "goto", url: "./app/next.html" }, { action: "goto", url: "https://example.com/x" }],
      }),
      scriptPath,
    );
    expect(script.url).toBe("file:///work/demos/app/index.html");
    expect(script.style?.background).toBe("/work/demos/bg.jpg");
    expect(script.steps).toEqual([{ action: "goto", url: "file:///work/demos/app/next.html" }, { action: "goto", url: "https://example.com/x" }]);
    expect(outPath).toBe("/work/demos/intro.demo.mp4");
  });

  test("keeps absolute paths and web URLs", () => {
    const { script, outPath } = resolveScript(makeScript({ url: "http://localhost:3000", output: { path: "/tmp/out.mp4" } }), scriptPath);
    expect(script.url).toBe("http://localhost:3000");
    expect(outPath).toBe("/tmp/out.mp4");
  });
});

describe("stepsKey", () => {
  const base: Step[] = [{ action: "click", target: "#add", zoom: { scale: 2, include: ["#list li"] }, caption: "Add" }];

  test("ignores what only changes the render", () => {
    const restyled: Step[] = [{ action: "click", target: "#add", zoom: { scale: 1.2, holdMs: 50, include: ["#list li"] }, caption: "Other" }];
    expect(stepsKey(restyled)).toBe(stepsKey(base));
  });

  test("changes when the recording would change", () => {
    expect(stepsKey([{ action: "click", target: "#other", zoom: { include: ["#list li"] } }])).not.toBe(stepsKey(base));
    expect(stepsKey([{ action: "click", target: "#add", zoom: { include: [] } }])).not.toBe(stepsKey(base));
    expect(stepsKey([...base, { action: "pause", ms: 100 }])).not.toBe(stepsKey(base));
  });

  test("does not depend on key order", () => {
    expect(stepsKey([{ target: "#a", action: "click" } as Step])).toBe(stepsKey([{ action: "click", target: "#a" }]));
  });
});

test("defaults and limits", () => {
  expect(outputOf(makeScript())).toEqual({ width: 2560, height: 1440, fps: 60 });
  const style = styleOf(makeScript({ style: { motionBlur: 3, shadow: -1 } }));
  expect(style.motionBlur).toBe(1);
  expect(style.shadow).toBe(0);
  expect(style.travelMs).toBe(800);
});
