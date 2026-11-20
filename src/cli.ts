#!/usr/bin/env bun
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { version } from "../package.json";
import { completion, isShell, SHELLS } from "./completion.ts";
import { ensureTool } from "./deps.ts";
import { actionDocs, overview } from "./docs.ts";
import { loadScript, scriptJsonSchema } from "./format.ts";
import { BUILD_ROOT, buildDir, initProject } from "./project.ts";
import { record } from "./record.ts";
import { render } from "./render.ts";
import { RENDER_WORKER_COMMAND, runRenderWorker } from "./render-worker.ts";
import { screensOf } from "./script.ts";
import { TRY_TIMEOUT_MS, tryScript } from "./try.ts";
import { describeVoice, pruneVoiceCache, speaker } from "./voice.ts";
import type { Recording } from "./types.ts";

const USAGE = `Usage: showem <command> <script> [--out <video.mp4>]

<script> is a .yaml or .json file, or - to read the script from stdin.
--out sets where the video goes (run, record, render, try), instead of the script's output.path.
The recording is kept in the system's temp folder under the video's path, so render needs the same --out as run.

In a project with .showem/ (see init), scripts use the settings in .showem/config.yaml,
and videos go to .showem/videos/ by default. ~/.showem/config.yaml sets them for every project.

Commands:
  check    Check the script for mistakes without running anything
  try      Run the steps in a headless browser at full speed, without recording, skipping \`wait\` steps.
           Stops at the first step that fails and saves a screenshot of each screen
  run      Record the script in a headless browser, then render the video
  record   Only record (raw frames and event log)
  render   Only render, from an earlier recording
  init     Create .showem/ in the current folder, with a config.yaml to fill in
  clean    Delete every recording kept for render, to free up space
  docs     Print the script format. \`showem docs <action>\` prints one action's fields
  schema   Print the script format as JSON Schema, for editors
  setup    Download the browser and ffmpeg into ~/.showem now, instead of on first use
  completion zsh|bash
           Print the shell script for tab completion

-v, --version prints the version. -h, --help prints this help.`;

const COMMANDS = ["check", "try", "run", "record", "render", "docs", "schema", "setup"] as const;
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
if (command === RENDER_WORKER_COMMAND) {
  await runRenderWorker(scriptArg);
  process.exit(0);
}
if (command === "--help" || command === "-h") {
  console.log(USAGE);
  process.exit(0);
}
if (command === "docs") {
  try {
    console.log(scriptArg ? actionDocs(scriptArg) : overview());
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  process.exit(0);
}
if (command === "completion") {
  if (!isShell(scriptArg)) {
    console.error(`Usage: showem completion ${SHELLS.join("|")}`);
    process.exit(1);
  }
  process.stdout.write(completion(scriptArg, [...COMMANDS, "init", "clean", "completion"]));
  process.exit(0);
}
if (command === "--version" || command === "-v") {
  console.log(version);
  process.exit(0);
}
if (command === "setup") {
  await ensureTool("chromium");
  await ensureTool("ffmpeg");
  console.log("Ready.");
  process.exit(0);
}
if (command === "init") {
  try {
    await initProject(process.cwd());
    console.log("Created .showem/config.yaml. Put secrets in .showem/.env, which git ignores.");
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  process.exit(0);
}
if (command === "clean") {
  await rm(BUILD_ROOT, { recursive: true, force: true });
  console.log(`Deleted ${BUILD_ROOT}`);
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

const loaded = await loadScript(scriptArg, command === "check" || command === "run" || command === "record");
const { problems } = loaded;
if (!("script" in loaded)) {
  const docs = problems.some((p) => / step \d+ \(/.test(p)) ? "\nRun `showem docs <action>` for an action's fields and an example." : "";
  (command === "check" ? console.log : console.error)(problems.join("\n") + docs);
  process.exit(1);
}
const { script } = loaded;
if (command === "check") {
  if (script.voice) console.log(describeVoice(script.voice));
  console.log("OK");
  process.exit(0);
}
const outPath = out ? resolve(out) : loaded.outPath;
const workDir = buildDir(outPath);

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
  if (script.voice) {
    console.error(describeVoice(script.voice));
    await pruneVoiceCache();
  }
  // A stand-in for the voice API, to test scripts and the skill without paying. Its clips are cached apart from real ones.
  // Only when running from source: scripts/build.ts replaces it with undefined in release binaries.
  const fakeApi = process.env.SHOWEM_VOICE_API;
  const speak = script.voice && (fakeApi ? speaker(script.voice, loaded.apiKey, join(BUILD_ROOT, "fake-voice"), fakeApi) : speaker(script.voice, loaded.apiKey));
  rec = await record(script, workDir, speak);
  console.error(`Recorded ${(rec.duration / 1000).toFixed(1)}s, ${Object.values(rec.screens).reduce((n, s) => n + s.frames.length, 0)} frames`);
  for (const stall of rec.stalls ?? []) {
    console.error(`${loaded.stepAt(stall.step)}: the browser stopped drawing for ${stall.ms} ms at ${(stall.t / 1000).toFixed(1)}s, so the video jumps there. If the page isn't busy there on every run, record again.`);
  }
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
