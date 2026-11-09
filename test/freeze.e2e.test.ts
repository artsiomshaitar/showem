import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record } from "../src/record.ts";
import { render } from "../src/render.ts";
import { resolveScript } from "../src/script.ts";
import type { Recording, Script } from "../src/types.ts";

let dir: string;
let script: Script;
let outPath: string;
let rec: Recording;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "showem-freeze-"));
  await Bun.write(
    join(dir, "admin.html"),
    `<style>html, body { height: 100%; margin: 0; background: #fff }</style>
     <button id="red" onclick="document.body.style.background = 'red'">Red</button>`,
  );
  ({ script, outPath } = resolveScript(
    {
      screens: {
        admin: { url: "./admin.html", frame: "none", viewport: { width: 640, height: 360 } },
        member: { url: "about:blank", frame: "none", viewport: { width: 640, height: 360 } },
      },
      deviceScaleFactor: 1,
      output: { width: 480, height: 270, fps: 30 },
      style: { motionBlur: 0 },
      steps: [
        { action: "wait", ms: 300 },
        { action: "pause-recording" },
        { action: "click", target: "#red" },
        { action: "switch", screen: "member" },
        { action: "resume-recording" },
        { action: "wait", ms: 300 },
      ],
    },
    join(dir, "freeze.demo.json"),
  ));
  rec = await record(script, join(dir, "work"));
  await render(script, rec, join(dir, "work"), outPath);
}, 60_000);

afterAll(() => rm(dir, { recursive: true, force: true }));

/** The color at the middle of the video at `ms`. */
function centerAt(ms: number) {
  const out = Bun.spawnSync([
    "ffmpeg", "-v", "error", "-ss", String(ms / 1000), "-i", outPath,
    "-vf", "crop=8:8:(iw-8)/2:(ih-8)/2,scale=1:1", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]).stdout;
  return { r: out[0]!, g: out[1]!, b: out[2]! };
}

test("the outgoing screen stays as it was before the pause while the video moves away from it", () => {
  const change = rec.switches[0]!;
  expect(change).toMatchObject({ from: "admin", to: "member", freezeOutgoing: true });
  // Just after the fade starts, the picture is still almost all admin: white, not the red a paused step made it.
  const { g } = centerAt(change.start + 50);
  expect(g).toBeGreaterThan(200);
});
