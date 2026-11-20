import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateKeys, record } from "../src/record.ts";
import { resolveScript } from "../src/script.ts";
import { tryScript } from "../src/try.ts";
import type { Point, Script, Step } from "../src/types.ts";

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
  dir = await mkdtemp(join(tmpdir(), "showem-inputs-"));
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

test("a goto path opens on the page's own site", async () => {
  const server = Bun.serve({ port: 0, fetch: (req) => new Response(`<h1>${new URL(req.url).pathname}</h1>`, { headers: { "content-type": "text/html" } }) });
  try {
    const script = resolveScript(
      { url: `http://localhost:${server.port}/start`, viewport: { width: 640, height: 400 }, deviceScaleFactor: 1, steps: [{ action: "goto", url: "/settings/team" }, { action: "wait-for", target: 'h1:has-text("/settings/team")' }] },
      join(dir, "goto.yaml"),
    ).script;
    expect((await tryScript(script, join(dir, "goto-try"))).failed).toBeUndefined();
  } finally {
    server.stop(true);
  }
}, 60_000);

test("try skips wait steps, and says so when a step right after one fails", async () => {
  const started = Date.now();
  const ok = await tryScript(scriptOf([{ action: "wait", ms: 30_000 }, { action: "type", target: "#time", text: "14:00" }, { action: "scroll", target: "#far" }]), join(dir, "try"));
  expect(ok.failed).toBeUndefined();
  expect(Date.now() - started).toBeLessThan(20_000);
  const failed = await tryScript(scriptOf([{ action: "wait", ms: 30_000 }, { action: "click", target: "#missing" }]), join(dir, "try"));
  expect(failed.failed).toMatchObject({ step: 1, afterWait: true });
}, 60_000);

test("the pointer clicks text fields where a person would, and typing adds to their text or replaces it", async () => {
  await Bun.write(
    join(dir, "fields.html"),
    `<body style="margin:0;font:16px sans-serif">
<input id="empty" style="display:block;width:600px;height:40px;padding:0 10px;font:16px sans-serif">
<input id="filled" value="Hello" style="display:block;width:600px;height:40px;padding:0 10px;font:16px sans-serif">
<textarea id="area" style="display:block;width:600px;height:200px;padding:10px;font:16px/20px sans-serif"></textarea>
<button id="go" style="display:block;width:600px;height:40px">Go</button>
<input id="amount" value="22700" style="display:block;width:200px;height:40px">
<input id="quiet" value="old" style="display:block;width:200px;height:40px">
<input id="clear" value="old" style="display:block;width:200px;height:40px"></body>`,
  );
  const script = resolveScript(
    {
      url: "./fields.html",
      viewport: { width: 640, height: 400 },
      deviceScaleFactor: 1,
      steps: [
        { action: "click", target: "#empty" },
        { action: "type", target: "#filled", text: " world" },
        { action: "click", target: "#area" },
        { action: "click", target: "#go" },
        { action: "save", as: "filled", target: "#filled", attribute: "value" },
        { action: "type", target: "#amount", text: "22500", replace: true },
        { action: "save", as: "amount", target: "#amount", attribute: "value" },
        { action: "pause-recording" },
        { action: "type", target: "#quiet", text: "new", replace: true },
        { action: "resume-recording" },
        { action: "save", as: "quiet", target: "#quiet", attribute: "value" },
        { action: "type", target: "#clear", text: "", replace: true },
        { action: "save", as: "clear", target: "#clear", attribute: "value" },
      ],
    },
    join(dir, "fields.yaml"),
  ).script;
  const rec = await record(script, join(dir, "fields-work"));
  const [empty, filled, area, go] = rec.steps.map((s) => s.point!) as [Point, Point, Point, Point];
  // Empty: a little in from the left edge, vertically centered.
  expect(empty.x).toBeGreaterThan(10);
  expect(empty.x).toBeLessThan(50);
  expect(empty.y).toBeCloseTo(20, 0);
  // With text: over the middle of "Hello", not the middle of the field.
  expect(filled.x).toBeGreaterThan(15);
  expect(filled.x).toBeLessThan(40);
  // A textarea: its first line, near the top-left.
  expect(area.x).toBeLessThan(60);
  expect(area.y - 80).toBeLessThan(35);
  // Anything else: the center.
  expect(go.x).toBeCloseTo(300, 0);
  expect(rec.vars.filled).toBe("Hello world");
  expect(rec.vars.amount).toBe("22500");
  // The camera follows the new text from the start of the field, not from the end of the text it replaces.
  const replaced = rec.steps[5]!.caret!;
  expect(replaced[0]!.x).toBeLessThan(replaced.at(-1)!.x);
  expect(rec.vars.clear).toBe("");
  // Off camera too.
  expect(rec.vars.quiet).toBe("new");
}, 60_000);
