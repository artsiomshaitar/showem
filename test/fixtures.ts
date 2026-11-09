import { toolPath } from "../src/deps.ts";
import { recordingKey } from "../src/script.ts";
import type { Recording, Script, ScreenRecording } from "../src/types.ts";

export const VIEWPORT = { width: 1440, height: 900 };
export const MAIN = { frame: "browser-safari", viewport: VIEWPORT } as const;

export function makeScript(overrides: Partial<Script> = {}): Script {
  return { url: "https://example.com", viewport: VIEWPORT, steps: [], ...overrides };
}

export function makeScreen(overrides: Partial<ScreenRecording> = {}): ScreenRecording {
  return {
    ...MAIN,
    frames: [{ file: "main/000000.jpg", t: 0 }],
    cursor: [{ t: 0, x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }],
    clicks: [],
    urls: [{ t: 0, url: "https://example.com" }],
    ...overrides,
  };
}

/** A one-screen recording; `screen` overrides that screen's fields. */
export function makeRecording(script: Script, overrides: Partial<Recording> = {}, screen: Partial<ScreenRecording> = {}): Recording {
  return {
    key: recordingKey(script),
    duration: 4000,
    firstScreen: "main",
    screens: { main: makeScreen(screen) },
    switches: [],
    steps: [],
    vars: {},
    ...overrides,
  };
}

/** "width,height,frames" of the video's first stream, counted by decoding it with the ffmpeg showem uses. */
export function probeVideo(path: string) {
  const log = Bun.spawnSync([toolPath("ffmpeg"), "-hide_banner", "-i", path, "-map", "0:v:0", "-f", "null", "-"]).stderr.toString();
  const [, width, height] = log.match(/Video: .*?, (\d+)x(\d+)/) ?? [];
  const frames = [...log.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1];
  return `${width},${height},${frames}`;
}
