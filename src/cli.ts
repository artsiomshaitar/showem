#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { actionDocs, overview } from "./docs.ts";
import { loadScript, scriptJsonSchema } from "./format.ts";
import { record } from "./record.ts";
import { render } from "./render.ts";
import { screensOf } from "./script.ts";
import { TRY_TIMEOUT_MS, tryScript } from "./try.ts";
import type { Recording } from "./types.ts";

const USAGE = `Usage: opendemo <command> <script> [--out <video.mp4>]

<script> is a .yaml or .json file, or - to read the script from stdin.
--out sets where the video goes (run, record, render, try), instead of the script's output.path.
The recording is kept next to it in <video.mp4>.opendemo/, so render needs the same --out as run.

Commands:
  check    Check the script for mistakes without running anything
  try      Run the steps in a headless browser at full speed, without recording, skipping \`wait\` steps.
           Stops at the first step that fails and saves a screenshot of each screen in <video.mp4>.opendemo/
  run      Record the script in a headless browser, then render the video
  record   Only record (raw frames and event log)
  render   Only render, from an earlier recording
  docs     Print the script format. \`opendemo docs <action>\` prints one action's fields
  schema   Print the script format as JSON Schema, for editors`;

const COMMANDS = ["check", "try", "run", "record", "render", "docs", "schema"] as const;
type Command = (typeof COMMANDS)[number];
const isCommand = (value: string | undefined): value is Command => COMMANDS.includes(value as Command);

const args = Bun.argv.slice(2);
const outAt = args.indexOf("--out");
const [, out] = outAt === -1 ? [] : args.splice(outAt, 2);
if (outAt !== -1 && !out) {
  console.error(USAGE);
  process.exit(1);
}
const [command, scriptArg] = args;
if (command === "docs") {
  try {
    console.log(scriptArg ? actionDocs(scriptArg) : overview());
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  process.exit(0);
}
if (command === "schema") {
  console.log(JSON.stringify(scriptJsonSchema(), null, 2));
  process.exit(0);
}
if (!isCommand(command) || !scriptArg) {
  console.error(USAGE);
  process.exit(1);
}

const loaded = await loadScript(scriptArg);
const { problems } = loaded;
if (!("script" in loaded)) {
  const docs = problems.some((p) => / step \d+ \(/.test(p)) ? "\nRun `opendemo docs <action>` for an action's fields and an example." : "";
  (command === "check" ? console.log : console.error)(problems.join("\n") + docs);
  process.exit(1);
}
if (command === "check") {
  console.log("OK");
  process.exit(0);
}
const { script } = loaded;
const outPath = out ? resolve(out) : loaded.outPath;
const workDir = `${outPath}.opendemo`;

if (command === "try") {
  const { failed, shots } = await tryScript(script, workDir);
  const list = Object.entries(shots).map(([name, path]) => `  ${name}: ${path}`).join("\n");
  if (failed) {
    const timeout = failed.message.includes(`Timeout ${TRY_TIMEOUT_MS}ms`) ? " Nothing matched in time: check the selector, or add a `wait-for` before it." : "";
    const wait = failed.afterWait ? " try skips `wait` steps. If the one before this step waits for the app, replace it with a `wait-for` on what the app shows when it's ready." : "";
    console.error(`${loaded.stepAt(failed.step)}: ${failed.message}${timeout}${wait}\nThe screens when it stopped:\n${list}`);
    process.exit(1);
  }
  console.log(`OK, ran ${script.steps.length} steps. The screens at the end:\n${list}`);
  process.exit(0);
}

let rec: Recording;
if (command === "render") {
  rec = await Bun.file(join(workDir, "recording.json")).json();
} else {
  console.error(`Recording ${Object.values(screensOf(script)).map((s) => s.url).join(", ")}`);
  rec = await record(script, workDir);
  console.error(`Recorded ${(rec.duration / 1000).toFixed(1)}s, ${Object.values(rec.screens).reduce((n, s) => n + s.frames.length, 0)} frames`);
}

if (command !== "record") {
  let shown = -1;
  await render(script, rec, workDir, outPath, (done, total) => {
    const pct = Math.floor((done / total) * 10) * 10;
    if (pct > shown) console.error(`Rendering ${pct}%`);
    shown = pct;
  });
  console.log(outPath);
}
