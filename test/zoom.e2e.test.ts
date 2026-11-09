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
  dir = await mkdtemp(join(tmpdir(), "showem-zoom-"));
  await Bun.write(join(dir, "page.html"), `<input id="name" style="position:absolute;left:40px;top:40px;width:120px"><button id="save" style="position:absolute;left:400px;top:300px">Save</button>`);
  const { script } = resolveScript(
    {
      url: "./page.html",
      viewport: { width: 640, height: 400 },
      deviceScaleFactor: 1,
      steps: [{ action: "zoom-in", target: "#name", keepInView: ["#save"] }, { action: "click", target: "#save" }, { action: "zoom-out" }],
    },
    join(dir, "demo.yaml"),
  );
  rec = await record(script, join(dir, "work"));
}, 60_000);

afterAll(() => rm(dir, { recursive: true, force: true }));

test("a zoom-in frames its target and every element in keep-in-view", () => {
  const { shotBox, actionAt } = rec.steps[0]!;
  expect(actionAt).toBeDefined();
  expect(shotBox!.x).toBeLessThanOrEqual(40);
  expect(shotBox!.y).toBeLessThanOrEqual(40);
  expect(shotBox!.x + shotBox!.width).toBeGreaterThan(400);
  expect(shotBox!.y + shotBox!.height).toBeGreaterThan(300);
});
