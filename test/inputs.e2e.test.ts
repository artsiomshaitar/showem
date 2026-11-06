import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateKeys, record } from "../src/record.ts";
import { resolveScript } from "../src/script.ts";
import { tryScript } from "../src/try.ts";
import type { Script, Step } from "../src/types.ts";

let dir: string;

const PAGE = `<input id="time" type="time" value="11:00"> <input id="day" type="date" value="2026-11-05"> <input id="at" type="datetime-local">
<p id="out"></p>
<div id="panel" style="height:100px;overflow:auto"><div style="height:200px"></div><p id="deep">Deep in the panel</p></div>
<div id="tall" style="height:2000px"></div><h2 id="far">Far below</h2><div style="height:600px"></div>
<script>
for (const el of document.querySelectorAll('input')) el.onchange = () => out.textContent = [time.value, day.value, at.value].join(' ');
addEventListener('scrollend', () => { const r = far.getBoundingClientRect(); if (r.top >= 0 && r.bottom <= innerHeight) document.title = 'far in view'; });
panel.onscroll = () => { const p = panel.getBoundingClientRect(), r = deep.getBoundingClientRect(); if (r.top >= p.top && r.bottom <= p.bottom) out.dataset.deep = 'shown'; };
</script>`;

const scriptOf = (steps: Step[]): Script =>
  resolveScript({ url: "./page.html", viewport: { width: 640, height: 400 }, deviceScaleFactor: 1, steps }, join(dir, "demo.yaml")).script;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "opendemo-inputs-"));
  await Bun.write(join(dir, "page.html"), PAGE);
});

afterAll(() => rm(dir, { recursive: true, force: true }));

test("dateKeys reads values the way people write them", () => {
  expect(dateKeys("time", "2:00 PM")).toEqual({ value: "14:00", keys: ["0200P"] });
  expect(dateKeys("time", "09:30")).toEqual({ value: "09:30", keys: ["0930A"] });
  expect(dateKeys("time", "12:15 am")).toEqual({ value: "00:15", keys: ["1215A"] });
  expect(dateKeys("date", "2026-11-07")).toEqual({ value: "2026-11-07", keys: ["11072026"] });
  expect(dateKeys("datetime-local", "2026-11-07T16:30")).toEqual({ value: "2026-11-07T16:30", keys: ["11072026", "ArrowRight", "0430P"] });
  expect(() => dateKeys("date", "11/07/2026")).toThrow("Write it like 2026-11-07");
});

test("type fills native date and time inputs part by part, and scroll brings a target into view", async () => {
  const rec = await record(
    scriptOf([
      { action: "type", target: "#time", text: "2:00 PM" },
      { action: "type", target: "#day", text: "2026-11-07" },
      { action: "type", target: "#at", text: "2026-11-07T16:30" },
      { action: "wait-for", target: "text=14:00 2026-11-07 2026-11-07T16:30" },
      { action: "scroll", target: "#deep" },
      { action: "save", as: "deep", target: "#out", attribute: "data-deep" },
      { action: "scroll", target: "#far" },
      { action: "save", as: "title", target: "title" },
      { action: "hover", target: "#tall" },
      { action: "hover", target: "#tall" },
    ]),
    join(dir, "work"),
  );
  expect(rec.vars.title).toBe("far in view");
  expect(rec.vars.deep).toBe("shown");
  // An element taller than the window can't be scrolled any further into view, so pointing at it again doesn't wait for a scroll.
  const again = rec.steps.at(-1)!;
  expect(again.end - again.start).toBeLessThan(2500);
}, 60_000);

test("try skips wait steps, and says so when a step right after one fails", async () => {
  const started = Date.now();
  const ok = await tryScript(scriptOf([{ action: "wait", ms: 30_000 }, { action: "type", target: "#time", text: "14:00" }, { action: "scroll", target: "#far" }]), join(dir, "try"));
  expect(ok.failed).toBeUndefined();
  expect(Date.now() - started).toBeLessThan(20_000);
  const failed = await tryScript(scriptOf([{ action: "wait", ms: 30_000 }, { action: "click", target: "#missing" }]), join(dir, "try"));
  expect(failed.failed).toMatchObject({ step: 1, afterWait: true });
}, 60_000);
