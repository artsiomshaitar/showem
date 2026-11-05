import { describe, expect, test } from "bun:test";
import { frameCount, splitFrames } from "../src/render.ts";
import { makeRecording, makeScript } from "./fixtures.ts";

describe("splitFrames", () => {
  test("covers every frame once, in order", () => {
    const ranges = splitFrames(813, 11);
    expect(ranges[0]?.[0]).toBe(0);
    expect(ranges.at(-1)?.[1]).toBe(813);
    ranges.slice(1).forEach(([from], i) => expect(from).toBe(ranges[i]?.[1] ?? -1));
    expect(ranges.length).toBeLessThanOrEqual(11);
  });

  test("never makes empty ranges", () => {
    expect(splitFrames(3, 8)).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(splitFrames(10, 0)).toEqual([[0, 10]]);
  });
});

test("frame count follows the duration and frame rate", () => {
  const script = makeScript({ output: { fps: 30 } });
  expect(frameCount(script, makeRecording(script, { duration: 1001 }))).toBe(31);
});
