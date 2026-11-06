import { describe, expect, test } from "bun:test";
import { checkScript, DEFAULT_ZOOM, fillStep, outputOf, resolveScript, screensOf, stepsKey, styleOf, zoomOf } from "../src/script.ts";
import type { Step } from "../src/types.ts";
import { makeScript, VIEWPORT } from "./fixtures.ts";

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

  test("resolves screen URLs, and leaves URLs with saved values for later", () => {
    const { script } = resolveScript(
      makeScript({ url: undefined, screens: { a: { url: "./a.html" } }, steps: [{ action: "goto", url: "${link}" }] }),
      scriptPath,
    );
    expect(script.screens?.a?.url).toBe("file:///work/demos/a.html");
    expect(script.steps).toEqual([{ action: "goto", url: "${link}" }]);
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
    expect(stepsKey([{ ...base[0]!, caption: "Add a row" }])).not.toBe(stepsKey(base));
  });

  test("ignores the switch transition, which only changes the render", () => {
    expect(stepsKey([{ action: "switch", screen: "a", transition: "slide" }])).toBe(stepsKey([{ action: "switch", screen: "a" }]));
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

describe("screensOf", () => {
  test("a script without screens has one, with the default frame", () => {
    expect(screensOf(makeScript())).toEqual({ main: { url: "https://example.com", frame: "browser-safari", viewport: VIEWPORT } });
  });

  test("a phone frame brings its own screen size", () => {
    const screens = screensOf(makeScript({ screens: { m: { url: "x", frame: "mobile-iphone", viewport: { width: 1, height: 1 } } } }));
    expect(screens.m?.viewport).toEqual({ width: 393, height: 798 });
  });
});

describe("checkScript", () => {
  const screens = { admin: { url: "a" }, member: { url: "b", frame: "mobile-iphone" as const } };

  test("accepts switches to known screens and values saved before use", () => {
    expect(() =>
      checkScript(makeScript({
        screens,
        steps: [
          { action: "save", as: "link", target: "#link", attribute: "href" },
          { action: "switch", screen: "member" },
          { action: "goto", url: "${link}" },
        ],
      })),
    ).not.toThrow();
  });

  test("rejects unknown screens and frames", () => {
    expect(() => checkScript(makeScript({ screens, steps: [{ action: "switch", screen: "nope" }] }))).toThrow(/no screen "nope"/);
    expect(() => checkScript(makeScript({ screens: { a: { url: "a", frame: "tv" as never } } }))).toThrow(/unknown frame/);
    expect(() => checkScript(makeScript({ screens, steps: [{ action: "switch", screen: "admin", transition: "zoom" as never }] }))).toThrow(/unknown transition/);
  });

  test("rejects screen names that don't start with a letter, since those would be put out of order", () => {
    expect(() => checkScript(makeScript({ screens: { "2": { url: "a" } } }))).toThrow(/must start with a letter/);
    expect(() => checkScript(makeScript({ screens: { "my screen": { url: "a" } } }))).toThrow(/must start with a letter/);
  });

  test("rejects a value used before it is saved", () => {
    const steps: Step[] = [{ action: "goto", url: "${link}" }, { action: "save", as: "link", from: "url" }];
    expect(() => checkScript(makeScript({ steps }))).toThrow(/Step 1 \(goto\) uses \$\{link\}/);
  });
});

test("fillStep fills saved values into every text field", () => {
  const step: Step = { action: "type", target: "#row-${id}", text: "Order ${id}", caption: "Open ${id}" };
  expect(fillStep(step, { id: "7" })).toEqual({ action: "type", target: "#row-7", text: "Order 7", caption: "Open 7" });
  expect(() => fillStep(step, {})).toThrow(/\$\{id\}/);
});
