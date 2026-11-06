import { describe, expect, test } from "bun:test";
import { checkScript, DEFAULT_ZOOM, fillStep, hiddenSteps, outputOf, pausesOf, readingMs, recordingKey, resolveScript, screensOf, stepsKey, styleOf, zoomOf } from "../src/script.ts";
import type { Script, Step } from "../src/types.ts";
import { makeScript, VIEWPORT } from "./fixtures.ts";

describe("zoomOf", () => {
  const click = (zoom?: true | number): Step => ({ action: "click", target: "#a", zoom });

  test("true uses the script's scale, a number its own", () => {
    expect(zoomOf(makeScript(), click(true))).toEqual({ scale: DEFAULT_ZOOM, holdMs: 300 });
    expect(zoomOf(makeScript({ zoom: 2.2, zoomHoldMs: 900 }), click(true))).toEqual({ scale: 2.2, holdMs: 900 });
    expect(zoomOf(makeScript({ zoom: 2.2 }), click(1.5))?.scale).toBe(1.5);
  });

  test("no zoom without the field", () => {
    expect(zoomOf(makeScript(), click())).toBeUndefined();
    expect(zoomOf(makeScript(), { action: "wait", ms: 100 })).toBeUndefined();
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
  const base: Step[] = [{ action: "click", target: "#add", zoom: 2, keepInView: ["#list li"], caption: "Add" }];

  test("ignores what only changes the render", () => {
    const restyled: Step[] = [{ action: "click", target: "#add", zoom: true, keepInView: ["#list li"], caption: "Other" }];
    expect(stepsKey(restyled)).toBe(stepsKey(base));
  });

  test("changes when the recording would change", () => {
    expect(stepsKey([{ action: "click", target: "#other", zoom: 2, keepInView: ["#list li"] }])).not.toBe(stepsKey(base));
    expect(stepsKey([{ action: "click", target: "#add", zoom: 2 }])).not.toBe(stepsKey(base));
    expect(stepsKey([...base, { action: "wait", ms: 100 }])).not.toBe(stepsKey(base));
    expect(stepsKey([{ ...base[0]!, caption: "Add a row" }])).not.toBe(stepsKey(base));
  });

  test("ignores captions on steps that aren't recorded", () => {
    const paused = (step: Step) => makeScript({ steps: [{ action: "pause-recording" }, step, { action: "resume-recording" }] });
    expect(recordingKey(paused({ action: "click", target: "#a", caption: "Two words" }))).toBe(recordingKey(paused({ action: "click", target: "#a" })));
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
  const problems = (overrides: Partial<Script>) => checkScript(makeScript(overrides));

  test("accepts switches to known screens and values saved before use", () => {
    const steps: Step[] = [
      { action: "save", as: "link", target: "#link", attribute: "href" },
      { action: "switch", screen: "member" },
      { action: "goto", url: "${link}" },
    ];
    expect(problems({ screens, steps })).toEqual([]);
  });

  test("rejects unknown screens, with a suggestion", () => {
    expect(problems({ screens, steps: [{ action: "switch", screen: "membr" }] })).toEqual([{ step: 0, message: expect.stringContaining('no screen "membr". Did you mean "member"?') }]);
    expect(problems({ steps: [{ action: "switch", screen: "a" }] })[0]?.message).toContain("needs `screens`");
  });

  test("rejects a value used before it is saved, and says how to fix it", () => {
    const steps: Step[] = [{ action: "goto", url: "${link}" }, { action: "save", as: "link", from: "url" }];
    expect(problems({ steps })).toEqual([{ step: 0, message: '"${link}" is used before it\'s saved. Add a `save` step with `as: link` before this step' }]);
  });

  test("keep-in-view needs zoom", () => {
    expect(problems({ steps: [{ action: "click", target: "#a", keepInView: ["#b"] }] })[0]?.message).toContain("only works with `zoom`");
  });

  test("reports every problem at once", () => {
    expect(problems({ screens, steps: [{ action: "switch", screen: "x" }, { action: "goto", url: "${a}" }, { action: "pause-recording" }] })).toHaveLength(3);
  });

  describe("pausing the recording", () => {
    const pause: Step = { action: "pause-recording" };
    const resume: Step = { action: "resume-recording" };

    test("accepts paused steps that save and use values", () => {
      const steps: Step[] = [pause, { action: "save", as: "link", from: "url" }, { action: "goto", url: "${link}" }, resume, pause, resume];
      expect(problems({ steps })).toEqual([]);
    });

    test("needs every pause resumed, and no resume without a pause", () => {
      expect(problems({ steps: [resume, pause, { action: "click", target: "#a" }] })).toEqual([
        { step: 0, message: expect.stringContaining("not paused") },
        { step: 1, message: expect.stringContaining("never resumed") },
      ]);
      expect(problems({ steps: [pause, pause, resume] })).toEqual([{ step: 1, message: expect.stringContaining("already paused at step 1") }]);
    });
  });
});

describe("pausesOf", () => {
  const screens = { one: { url: "a" }, two: { url: "b" }, three: { url: "c" } };
  const pause: Step = { action: "pause-recording" };
  const resume: Step = { action: "resume-recording" };
  const shown: Step = { action: "wait", ms: 1 };

  test("goes from the screen at the pause to the screen at the resume, with the last switch's transition", () => {
    const steps: Step[] = [shown, pause, { action: "switch", screen: "two" }, { action: "switch", screen: "three", transition: "slide" }, resume];
    expect(pausesOf(makeScript({ screens, steps }))).toEqual([{ start: 1, end: 4, from: "one", to: "three", atStart: false, switchStep: 3 }]);
  });

  test("resuming on the same screen doesn't change screens, even after switching away and back", () => {
    const steps: Step[] = [shown, pause, { action: "switch", screen: "two" }, { action: "switch", screen: "one" }, resume];
    expect(pausesOf(makeScript({ screens, steps }))).toEqual([{ start: 1, end: 4, from: "one", to: "one", atStart: false, switchStep: undefined }]);
  });

  test("a pause before anything is shown doesn't change screens: the video starts on the screen it resumes on", () => {
    const steps: Step[] = [pause, { action: "switch", screen: "two" }, resume, shown];
    expect(pausesOf(makeScript({ screens, steps }))[0]).toMatchObject({ to: "two", atStart: true, switchStep: undefined });
  });
});

describe("visual options on steps that aren't recorded", () => {
  const screens = { one: { url: "a" }, two: { url: "b" } };
  const shown: Step = { action: "wait", ms: 1, caption: "Shown" };

  test("are rejected, except on the switch used on resume", () => {
    const steps: Step[] = [
      shown,
      { action: "pause-recording" },
      { action: "click", target: "#a", zoom: true, caption: "Hidden" },
      { action: "switch", screen: "two", transition: "slide", caption: "Used" },
      { action: "resume-recording" },
    ];
    const script = makeScript({ screens, steps });
    expect([...hiddenSteps(script)]).toEqual([1, 2, 4]);
    expect(checkScript(script)).toEqual([{ step: 2, message: "this step runs while recording is paused, so its `caption` and `zoom` are never shown. Remove them" }]);
  });

  test("a switch that ends on the screen it started from shows nothing", () => {
    const steps: Step[] = [shown, { action: "pause-recording" }, { action: "switch", screen: "one", transition: "slide" }, { action: "resume-recording" }];
    expect(checkScript(makeScript({ screens, steps }))).toEqual([{ step: 2, message: expect.stringContaining("its `transition` is never shown") }]);
  });
});

test("fillStep fills saved values into every text field", () => {
  const step: Step = { action: "type", target: "#row-${id}", text: "Order ${id}", caption: "Open ${id}" };
  expect(fillStep(step, { id: "7" })).toEqual({ action: "type", target: "#row-7", text: "Order 7", caption: "Open 7" });
  expect(() => fillStep(step, {})).toThrow(/\$\{id\}/);
});

test("a value not filled in yet counts as three words of reading time", () => {
  expect(readingMs("Code ${code}")).toBe(readingMs("Code one two three"));
});
