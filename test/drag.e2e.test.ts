import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record } from "../src/record.ts";
import { resolveScript } from "../src/script.ts";
import { tryScript } from "../src/try.ts";
import type { Script, Step } from "../src/types.ts";

let dir: string;

// The box only moves once the pointer has been held for a moment, like drag libraries with a press delay.
const PAGE = `<body style="margin:0">
<div id="box" style="position:absolute;left:20px;top:20px;width:60px;height:60px;background:teal"></div>
<div id="target" style="position:absolute;left:400px;top:250px;width:100px;height:100px;outline:1px solid"></div>
<script>
let grab = null, moves = [];
box.onpointerdown = (e) => { grab = { x: e.clientX - box.offsetLeft, y: e.clientY - box.offsetTop, at: performance.now() }; };
addEventListener('pointermove', (e) => {
  if (!grab || performance.now() - grab.at < 100) return;
  moves.push(performance.now());
  box.style.left = (e.clientX - grab.x) + 'px';
  box.style.top = (e.clientY - grab.y) + 'px';
});
addEventListener('pointerup', () => {
  grab = null;
  box.dataset.at = box.offsetLeft + ',' + box.offsetTop;
  box.dataset.moves = moves.length;
  box.dataset.span = Math.round(moves.at(-1) - moves[0]);
  moves = [];
});
</script>`;

const scriptOf = (steps: Step[]): Script =>
  resolveScript({ url: "./page.html", viewport: { width: 640, height: 400 }, deviceScaleFactor: 1, steps }, join(dir, "demo.yaml")).script;

const at = (as: string): Step => ({ action: "save", as, target: "#box", attribute: "data-at" });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "showem-drag-"));
  await Bun.write(join(dir, "page.html"), PAGE);
});

afterAll(() => rm(dir, { recursive: true, force: true }));

// How many moves fit depends on the machine, so this checks that they keep coming for the whole drag instead of counting them.
test("drag holds the button and keeps moving for the whole drag, by pixels or onto an element", async () => {
  const durationMs = 600;
  const rec = await record(
    scriptOf([
      { action: "drag", target: "#box", by: { x: 100, y: 50 }, durationMs },
      at("by"),
      { action: "save", as: "moves", target: "#box", attribute: "data-moves" },
      { action: "save", as: "span", target: "#box", attribute: "data-span" },
      { action: "drag", target: "#box", to: "#target" },
      at("to"),
    ]),
    join(dir, "work"),
  );
  expect(rec.vars.by).toBe("120,70");
  expect(rec.vars.to).toBe("420,270");
  expect(Number(rec.vars.moves)).toBeGreaterThan(2);
  expect(Number(rec.vars.span)).toBeGreaterThanOrEqual(durationMs * 0.75);
  const { holds = [], cursor } = rec.screens.main!;
  expect(holds).toHaveLength(2);
  const first = rec.steps[0]!;
  expect(holds[0]!.down).toBeGreaterThanOrEqual(first.actionAt!);
  expect(holds[0]!.up).toBeLessThanOrEqual(first.end);
  const held = cursor.filter((c) => c.t > holds[0]!.down && c.t < holds[0]!.up);
  expect(held.at(-1)!.t - held[0]!.t).toBeGreaterThanOrEqual(durationMs * 0.75);
}, 60_000);

test("off camera a drag still waits for the grab, and a drop point off the page fails", async () => {
  const ok = await tryScript(scriptOf([{ action: "drag", target: "#box", by: { x: 100 } }, { action: "wait-for", target: "#box[data-at='120,20']" }]), join(dir, "try"));
  expect(ok.failed).toBeUndefined();
  const off = await tryScript(scriptOf([{ action: "drag", target: "#box", by: { y: 1000 } }]), join(dir, "try"));
  expect(off.failed).toMatchObject({ step: 0 });
  expect(off.failed?.message).toContain("outside the 640 x 400 page");
}, 60_000);
