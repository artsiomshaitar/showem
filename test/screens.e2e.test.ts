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
  dir = await mkdtemp(join(tmpdir(), "showem-screens-"));
  await Bun.write(
    join(dir, "admin.html"),
    `<a id="link" href="./member.html?id=42">Open</a>
     <button id="copy" onclick="navigator.clipboard.writeText('copied-7')">Copy</button>
     <script>document.cookie = "who=admin"</script>`,
  );
  await Bun.write(join(dir, "member.html"), `<p id="who"></p><button id="tap" onclick="this.textContent='Tapped'">Tap</button><script>who.textContent = document.cookie || "nobody"</script>`);
  ({ script, outPath } = resolveScript(
    {
      screens: {
        admin: { url: "./admin.html", frame: "browser-chrome", viewport: { width: 640, height: 400 } },
        member: { url: "about:blank", frame: "mobile-iphone" },
      },
      deviceScaleFactor: 1,
      output: { width: 480, height: 270, fps: 30 },
      steps: [
        { action: "save", as: "link", target: "#link", attribute: "href" },
        { action: "click", target: "#copy" },
        { action: "save", as: "code", from: "clipboard" },
        { action: "switch", screen: "member", transition: "slide", caption: "Code ${code}" },
        { action: "goto", url: "${link}" },
        { action: "click", target: "#tap", zoom: true },
        { action: "wait-for", target: "text=Tapped" },
        { action: "save", as: "page", from: "url" },
        { action: "save", as: "who", target: "#who" },
        { action: "pause-recording" },
        { action: "switch", screen: "admin", transition: "slide", caption: "Back to admin" },
        { action: "resume-recording" },
      ],
    },
    join(dir, "screens.demo.json"),
  ));
  rec = await record(script, join(dir, "work"));
}, 60_000);

afterAll(() => rm(dir, { recursive: true, force: true }));

test("saves values from attributes, the clipboard, the URL and text, and uses them later", () => {
  expect(rec.vars.link).toEndWith("/member.html?id=42");
  expect(rec.vars.code).toBe("copied-7");
  expect(rec.vars.page).toBe(rec.vars.link!);
});

test("screens have their own cookies", () => {
  expect(rec.vars.who).toBe("nobody");
});

test("records every screen for the whole run, with the switch between them", () => {
  expect(rec.switches[0]).toMatchObject({ from: "admin", to: "member" });
  expect(rec.switches[0]).not.toHaveProperty("freezeOutgoing");
  expect(rec.screens.admin?.frames.length).toBeGreaterThan(0);
  expect(rec.screens.member?.frames.length).toBeGreaterThan(0);
  expect(rec.screens.member?.viewport).toEqual({ width: 393, height: 798 });
  expect(rec.screens.member?.clicks).toHaveLength(1);
  expect(rec.steps.filter((s) => s.screen === "member").map((s) => s.index)).toEqual([3, 4, 5, 6, 7, 8, 9]);
});

test("switching while paused moves to the other screen on resume, with that switch's caption first", () => {
  const resumed = rec.switches[1]!;
  expect(resumed).toMatchObject({ step: 10, from: "member", to: "admin", freezeOutgoing: true });
  expect(rec.steps[10]!.start).toBeLessThan(resumed.start);
  expect(rec.steps[10]!.end).toBeGreaterThan(resumed.end);
});

test("renders one video across both screens", async () => {
  await render(script, rec, join(dir, "work"), outPath);
  const probe = Bun.spawnSync(["ffprobe", "-v", "error", "-count_frames", "-show_entries", "stream=nb_read_frames,width,height", "-of", "csv=p=0", outPath]);
  expect(probe.stdout.toString().trim()).toBe(`480,270,${frameCount(script, rec)}`);
}, 60_000);

test("a video that starts paused starts on the screen it resumes on, at time 0", async () => {
  const started: Script = {
    ...script,
    steps: [
      { action: "pause-recording" },
      { action: "resume-recording" },
      { action: "pause-recording" },
      { action: "switch", screen: "member" },
      { action: "resume-recording" },
      { action: "wait", ms: 100 },
    ],
  };
  const rec = await record(started, join(dir, "started"));
  expect(rec.firstScreen).toBe("member");
  expect(rec.switches).toEqual([]);
  expect(Math.min(...rec.steps.map((s) => s.start))).toBe(0);
}, 30_000);

test("stops with a clear error when there is nothing to save from", async () => {
  const broken: Script = { ...script, steps: [{ action: "save", as: "x", target: "#missing" }] };
  expect(record(broken, join(dir, "broken"))).rejects.toThrow(/save "x": nothing matches #missing/);
}, 30_000);
