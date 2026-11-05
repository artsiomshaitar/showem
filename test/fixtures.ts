import { stepsKey } from "../src/script.ts";
import type { Recording, Script, StepLog } from "../src/types.ts";

export const VIEWPORT = { width: 1440, height: 900 };

export function makeScript(overrides: Partial<Script> = {}): Script {
  return { url: "https://example.com", viewport: VIEWPORT, steps: [], ...overrides };
}

export function makeRecording(script: Script, overrides: Partial<Recording> & { steps?: StepLog[] } = {}): Recording {
  return {
    stepsKey: stepsKey(script.steps),
    viewport: VIEWPORT,
    duration: 4000,
    frames: [{ file: "000000.jpg", t: 0 }],
    cursor: [{ t: 0, x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }],
    clicks: [],
    steps: [],
    urls: [{ t: 0, url: script.url }],
    ...overrides,
  };
}
