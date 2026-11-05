import { describe, expect, test } from "bun:test";
import { assertRecordingMatches, buildCaptions, buildCursor, plan } from "../src/plan.ts";
import type { Step } from "../src/types.ts";
import { makeRecording, makeScript } from "./fixtures.ts";

describe("buildCursor", () => {
  const script = makeScript();
  const rec = makeRecording(script, { cursor: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 100, y: 50 }], clicks: [100] });
  const cursor = buildCursor(rec);

  test("interpolates between samples and holds the last one", () => {
    expect(cursor(50)).toMatchObject({ x: 50, y: 25 });
    expect(cursor(500)).toMatchObject({ x: 100, y: 50 });
  });

  test("reports click progress", () => {
    expect(cursor(50).press).toBe(0);
    expect(cursor(100 + 130).press).toBeCloseTo(0.5);
    expect(cursor(100 + 300).press).toBe(0);
  });
});

test("each caption lasts until the next one", () => {
  const steps: Step[] = [{ action: "pause", ms: 1, caption: "One" }, { action: "pause", ms: 1 }, { action: "pause", ms: 1, caption: "Two" }];
  const script = makeScript({ steps });
  const rec = makeRecording(script, {
    duration: 900,
    steps: [{ index: 0, start: 0, end: 100 }, { index: 1, start: 100, end: 300 }, { index: 2, start: 300, end: 800 }],
  });
  expect(buildCaptions(script, rec)).toEqual([{ text: "One", start: 0, end: 300 }, { text: "Two", start: 300, end: 900 }]);
});

test("typing lasts from the first caret sample to the end of the step", () => {
  const steps: Step[] = [{ action: "type", target: "#a", text: "ab" }];
  const script = makeScript({ steps });
  const rec = makeRecording(script, {
    steps: [{ index: 0, start: 0, actionAt: 100, end: 600, caret: [{ t: 200, x: 0, y: 0 }, { t: 300, x: 5, y: 0 }] }],
  });
  const { isTyping } = plan(script, rec);
  expect(isTyping(150)).toBe(false);
  expect(isTyping(400)).toBe(true);
  expect(isTyping(600)).toBe(false);
});

describe("assertRecordingMatches", () => {
  const script = makeScript({ steps: [{ action: "click", target: "#a" }] });
  const rec = makeRecording(script);

  test("accepts changes that only affect the render", () => {
    expect(() => assertRecordingMatches({ ...script, steps: [{ action: "click", target: "#a", caption: "Hi", zoom: 2 }] }, rec)).not.toThrow();
  });

  test("rejects steps that were changed after recording", () => {
    expect(() => assertRecordingMatches({ ...script, steps: [] }, rec)).toThrow(/opendemo run/);
    expect(() => assertRecordingMatches({ ...script, steps: [{ action: "click", target: "#b" }] }, rec)).toThrow();
  });
});
