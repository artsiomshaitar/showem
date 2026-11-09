import { describe, expect, test } from "bun:test";
import { assertRecordingMatches, buildCaptions, buildCursor, buildTap, plan, sceneAt } from "../src/plan.ts";
import type { Step } from "../src/types.ts";
import { makeRecording, makeScreen, makeScript } from "./fixtures.ts";

describe("buildCursor", () => {
  const screen = makeScreen({ cursor: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 100, y: 50 }], clicks: [100] });
  const cursor = buildCursor(screen);

  test("interpolates between samples and holds the last one", () => {
    expect(cursor(50)).toMatchObject({ x: 50, y: 25 });
    expect(cursor(500)).toMatchObject({ x: 100, y: 50 });
  });

  test("reports click progress", () => {
    expect(cursor(50).press).toBe(0);
    expect(cursor(100 + 130).press).toBeCloseTo(0.5);
    expect(cursor(100 + 300).press).toBe(0);
  });

  test("on a touch screen it jumps from tap to tap", () => {
    expect(buildCursor(screen, true)(50)).toMatchObject({ x: 0, y: 0 });
  });
});

test("a tap fades in at its spot before it lands, then fades out", () => {
  const tap = buildTap(makeScreen({ cursor: [{ t: 0, x: 0, y: 0 }, { t: 820, x: 40, y: 60 }], clicks: [1000] }));
  expect(tap(700)).toBeUndefined();
  expect(tap(910)).toMatchObject({ x: 40, y: 60, press: 0 });
  expect(tap(910)?.alpha).toBeCloseTo(0.5);
  expect(tap(1100)).toMatchObject({ alpha: 1 });
  expect(tap(1100)?.press).toBeGreaterThan(0);
  expect(tap(1500)).toBeUndefined();
});

test("each caption lasts until the next one, with saved values filled in", () => {
  const steps: Step[] = [{ action: "wait", ms: 1, caption: "One" }, { action: "wait", ms: 1 }, { action: "wait", ms: 1, caption: "Record ${id}" }];
  const script = makeScript({ steps });
  const rec = makeRecording(script, {
    duration: 900,
    vars: { id: "42" },
    steps: [{ index: 0, screen: "main", start: 0, end: 100 }, { index: 1, screen: "main", start: 100, end: 300 }, { index: 2, screen: "main", start: 300, end: 800 }],
  });
  expect(buildCaptions(script, rec)).toEqual([{ text: "One", start: 0, end: 300 }, { text: "Record 42", start: 300, end: 720 }]);
});

test("typing lasts from the first caret sample to the end of the step", () => {
  const steps: Step[] = [{ action: "type", target: "#a", text: "ab" }];
  const script = makeScript({ steps });
  const rec = makeRecording(script, {
    steps: [{ index: 0, screen: "main", start: 0, actionAt: 100, end: 600, caret: [{ t: 200, x: 0, y: 0 }, { t: 300, x: 5, y: 0 }] }],
  });
  const { isTyping } = plan(script, rec).screens.main!;
  expect(isTyping(150)).toBe(false);
  expect(isTyping(400)).toBe(true);
  expect(isTyping(600)).toBe(false);
});

test("the scene follows the switches, with each step's transition", () => {
  const script = makeScript({
    steps: [{ action: "switch", screen: "b" }, { action: "switch", screen: "a", transition: "slide" }],
  });
  const rec = makeRecording(script, {
    firstScreen: "a",
    screens: { a: makeScreen(), b: makeScreen() },
    switches: [
      { step: 0, leave: 500, start: 1000, end: 1500, from: "a", to: "b" },
      { step: 1, leave: 2500, start: 3000, end: 3500, from: "b", to: "a" },
    ],
  });
  expect(sceneAt(script, rec, 800)).toEqual({ screen: "a" });
  expect(sceneAt(script, rec, 1250)).toEqual({ from: "a", to: "b", k: 0.5, transition: "fade", direction: 1 });
  expect(sceneAt(script, rec, 2000)).toEqual({ screen: "b" });
  expect(sceneAt(script, rec, 3250)).toMatchObject({ transition: "slide", direction: -1 });
  expect(sceneAt(script, rec, 3600)).toEqual({ screen: "a" });
});

test("a switch on resume moves from the moment before the pause to the screen it resumes on, with the paused switch's transition", () => {
  const steps: Step[] = [
    { action: "wait", ms: 1 },
    { action: "pause-recording" },
    { action: "switch", screen: "b", transition: "slide", caption: "To b" },
    { action: "click", target: "#x", caption: "Hidden" },
    { action: "resume-recording" },
  ];
  const script = makeScript({ screens: { a: { url: "a" }, b: { url: "b" } }, steps });
  const rec = makeRecording(script, {
    firstScreen: "a",
    screens: { a: makeScreen(), b: makeScreen() },
    switches: [{ step: 2, leave: 500, start: 1000, end: 1500, from: "a", to: "b", freezeOutgoing: true }],
    steps: steps.map((_, index) => ({ index, screen: "a", start: index === 2 ? 900 : 100 * index, end: 100 * index })),
  });
  expect(sceneAt(script, rec, 800)).toEqual({ screen: "a" });
  expect(sceneAt(script, rec, 1250)).toMatchObject({ from: "a", to: "b", k: 0.5, transition: "slide", direction: 1 });
  expect(buildCaptions(script, rec).map((c) => [c.text, c.start])).toEqual([["To b", 900]]);
  expect(sceneAt(script, rec, 1250)).toHaveProperty("fromAt", expect.closeTo(1000, 1));
  expect(sceneAt(script, rec, 1600)).toEqual({ screen: "b" });
});

describe("assertRecordingMatches", () => {
  const script = makeScript({ steps: [{ action: "click", target: "#a", caption: "Hello" }] });
  const rec = makeRecording(script);

  test("accepts changes that only affect the render", () => {
    expect(() => assertRecordingMatches({ ...script, steps: [{ action: "click", target: "#a", caption: "Hi", zoom: 2 }] }, rec)).not.toThrow();
  });

  test("rejects a caption that needs a different reading time", () => {
    expect(() => assertRecordingMatches({ ...script, steps: [{ action: "click", target: "#a", caption: "Hi there" }] }, rec)).toThrow();
  });

  test("rejects steps or screens that were changed after recording", () => {
    expect(() => assertRecordingMatches({ ...script, steps: [] }, rec)).toThrow(/showem run/);
    expect(() => assertRecordingMatches({ ...script, steps: [{ action: "click", target: "#b", caption: "Hello" }] }, rec)).toThrow();
    expect(() => assertRecordingMatches({ ...script, screens: { main: { url: script.url!, frame: "mobile-iphone" } } }, rec)).toThrow();
  });
});
