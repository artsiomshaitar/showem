import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record } from "../src/record.ts";
import { resolveScript } from "../src/script.ts";
import type { Recording } from "../src/types.ts";

let dir: string;
let rec: Recording;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "showem-stall-"));
  // Both buttons change the page on every frame for 600 ms. "Block" first freezes the page for 400 ms, right in its
  // click handler, so the stall starts at the click whatever the machine's speed.
  await Bun.write(
    join(dir, "index.html"),
    `<span id="count">0</span> <button id="smooth">Smooth</button> <button id="block">Block</button>
     <script>
       function run() {
         const start = performance.now();
         const tick = (now) => {
           document.getElementById("count").textContent = Math.round(now - start);
           if (now - start < 600) requestAnimationFrame(tick);
         };
         requestAnimationFrame(tick);
       }
       document.getElementById("smooth").onclick = run;
       document.getElementById("block").onclick = () => {
         const until = performance.now() + 400;
         while (performance.now() < until);
         run();
       };
     </script>`,
  );
  const { script } = resolveScript(
    {
      url: "./index.html",
      viewport: { width: 640, height: 360 },
      deviceScaleFactor: 1,
      steps: [
        { action: "click", target: "#smooth" },
        { action: "wait", ms: 900 },
        { action: "click", target: "#block" },
        { action: "wait", ms: 900 },
      ],
    },
    join(dir, "stall.demo.json"),
  );
  rec = await record(script, join(dir, "work"));
}, 60_000);

afterAll(() => rm(dir, { recursive: true, force: true }));

test("a moment the page stops drawing while it changes is reported with its step", () => {
  // A slow machine can add short stalls of its own, so this looks at the longest one at the click.
  const atClick = (rec.stalls ?? []).filter((s) => s.step === 2);
  expect(atClick.length).toBeGreaterThan(0);
  const stall = atClick.reduce((a, b) => (b.ms > a.ms ? b : a));
  expect(stall.ms).toBeGreaterThanOrEqual(380);
  const step = rec.steps.find((l) => l.index === 2)!;
  expect(stall.t).toBeGreaterThanOrEqual(step.start);
  expect(stall.t).toBeLessThanOrEqual(step.end);
});
