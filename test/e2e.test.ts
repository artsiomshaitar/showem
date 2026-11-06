import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record } from "../src/record.ts";
import { frameCount, render } from "../src/render.ts";
import { resolveScript } from "../src/script.ts";
import type { Recording, Script } from "../src/types.ts";

let dir: string;
let script: Script;
let outPath: string;
let rec: Recording;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "opendemo-e2e-"));
  await Bun.write(join(dir, "start.html"), `<a href="./form.html">Next</a>`);
  await Bun.write(
    join(dir, "form.html"),
    `<input id="name" style="margin:40px"><button id="save" onclick="document.body.append(Object.assign(document.createElement('p'),{id:'done',textContent:'Saved'}))">Save</button>`,
  );
  const scriptPath = join(dir, "flow.demo.json");
  ({ script, outPath } = resolveScript(
    {
      url: "./start.html",
      viewport: { width: 640, height: 400 },
      deviceScaleFactor: 1,
      output: { width: 480, height: 270, fps: 30 },
      steps: [
        { action: "pause-recording" },
        { action: "goto", url: "./form.html" },
        { action: "resume-recording" },
        { action: "type", target: "#name", text: "Ada", delayMs: 10, zoom: 2, caption: "Type a name" },
        { action: "click", target: "#save", zoom: true, keepInView: ["#done"] },
        { action: "wait-for", target: "#done" },
        { action: "pause-recording" },
        { action: "type", target: "#name", text: " Lovelace" },
        { action: "wait", ms: 1500 },
        { action: "resume-recording" },
        { action: "wait", ms: 300 },
      ],
    },
    scriptPath,
  ));
  rec = await record(script, join(dir, "work"));
}, 60_000);

afterAll(() => rm(dir, { recursive: true, force: true }));

test("records every step, including a relative goto", () => {
  expect(rec.steps).toHaveLength(11);
  expect(rec.screens.main?.urls.map((u) => u.url.split("/").pop())).toEqual(["start.html", "form.html"]);
  expect(rec.steps[3]?.caret?.length).toBe(4);
  expect(rec.steps[4]?.shotBox).toBeDefined();
  expect(rec.screens.main?.frames.length).toBeGreaterThan(0);
});

test("leaves paused steps out of the recording", () => {
  const main = rec.screens.main!;
  // Paused at the start: the video opens on the form, with nothing to fade from.
  expect(main.urls[1]?.t).toBe(0);
  // Paused and resumed on the same screen: the video just carries on.
  expect(rec.switches).toEqual([]);
  const [pause, typed, wait, resume] = rec.steps.slice(6, 10);
  expect(typed?.start).toBe(pause!.end);
  expect(wait?.end).toBe(typed!.start);
  expect(resume!.end - pause!.start).toBeLessThan(300);
  expect(typed?.caret).toBeUndefined();
  expect(main.clicks).toHaveLength(2);
  expect(main.frames.map((f) => f.t)).toEqual(main.frames.map((f) => f.t).toSorted((a, b) => a - b));
});

test("renders a video with one frame per output tick", async () => {
  await render(script, rec, join(dir, "work"), outPath);
  const probe = Bun.spawnSync(["ffprobe", "-v", "error", "-count_frames", "-show_entries", "stream=nb_read_frames,width,height", "-of", "csv=p=0", outPath]);
  expect(probe.stdout.toString().trim()).toBe(`480,270,${frameCount(script, rec)}`);
}, 60_000);

test("refuses to render after the steps changed", () => {
  const changed = { ...script, steps: script.steps.slice(1) };
  expect(render(changed, rec, join(dir, "work"), outPath)).rejects.toThrow(/opendemo run/);
});
