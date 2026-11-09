import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record } from "../src/record.ts";
import { resolveScript } from "../src/script.ts";
import { tryScript } from "../src/try.ts";
import type { Recording, Script, Step } from "../src/types.ts";

let dir: string;
let page: string;
let rec: Recording;

const PAGE = `<select id="reason"><option>Pick one</option><option>Added work</option><option>Waiting on parts</option></select>
<p id="out"></p><p id="picks"></p>
<button id="color">Color</button><div id="list" role="listbox" hidden><div role="option">Red</div><div role="option">Green</div></div>
<script>
reason.onchange = () => out.textContent = 'Picked ' + reason.value;
color.onclick = () => setTimeout(() => list.hidden = false, 1000);
let picked = 0;
list.onclick = (e) => { color.textContent = e.target.textContent; list.hidden = true; picks.textContent = 'Picked ' + ++picked + ' times'; };
</script>`;

const scriptOf = (steps: Step[]): Script =>
  resolveScript({ url: "./page.html", viewport: { width: 640, height: 400 }, deviceScaleFactor: 1, steps }, join(dir, "demo.yaml")).script;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "showem-select-"));
  page = join(dir, "page.html");
  await Bun.write(page, PAGE);
  rec = await record(
    scriptOf([
      { action: "select", target: "#reason", option: "Waiting on parts", zoom: true },
      { action: "wait-for", target: "text=Picked Waiting on parts" },
      { action: "select", target: "#color", option: "Green" },
      { action: "wait-for", target: "#color:has-text('Green')" },
    ]),
    join(dir, "work"),
  );
}, 60_000);

afterAll(() => rm(dir, { recursive: true, force: true }));

test("a native select logs a menu for the render to draw, and picks the option", () => {
  const { menu, shotBox } = rec.steps[0]!;
  expect(menu?.options).toEqual(["Pick one", "Added work", "Waiting on parts"]);
  expect([menu?.from, menu?.to]).toEqual([0, 2]);
  expect(menu!.closeAt).toBeGreaterThan(menu!.openAt);
  expect(shotBox!.height).toBeGreaterThan(menu!.box.height);
});

test("on a phone, a native select logs Safari's menu", async () => {
  const phone = resolveScript(
    { screens: { phone: { url: "./page.html", frame: "mobile-iphone" } }, deviceScaleFactor: 1, steps: [{ action: "select", target: "#reason", option: "Added work" }, { action: "wait-for", target: "text=Picked Added work" }] },
    join(dir, "demo.yaml"),
  ).script;
  const { menu } = (await record(phone, join(dir, "phone"))).steps[0]!;
  expect(menu?.ios).toBe(true);
  expect(menu?.rowHeight).toBe(44);
}, 60_000);

test("a dropdown made of page elements is clicked open, then its option is clicked", () => {
  expect(rec.steps[2]?.menu).toBeUndefined();
  expect(rec.screens.main?.clicks).toHaveLength(4);
});

test("a dropdown whose trigger already shows the option waits for the option it opened", async () => {
  const steps: Step[] = [
    { action: "select", target: "#color", option: "Green" },
    { action: "select", target: "#color", option: "Green" },
    { action: "wait-for", target: "text=Picked 2 times" },
  ];
  expect((await tryScript(scriptOf(steps), join(dir, "try-again"))).failed).toBeUndefined();
  await record(scriptOf(steps), join(dir, "again"));
}, 60_000);

test("try runs every step and screenshots each screen", async () => {
  const result = await tryScript(scriptOf([{ action: "select", target: "#reason", option: "Added work" }, { action: "wait-for", target: "text=Picked Added work" }]), join(dir, "try"));
  expect(result.failed).toBeUndefined();
  expect(await Bun.file(result.shots.main!).exists()).toBe(true);
});

test("try stops at the first step that fails, naming the options there are", async () => {
  const result = await tryScript(scriptOf([{ action: "wait", ms: 1 }, { action: "select", target: "#reason", option: "Nope" }, { action: "click", target: "#color" }]), join(dir, "try"));
  expect(result.failed?.step).toBe(1);
  expect(result.failed?.message).toContain('"Waiting on parts"');
});
