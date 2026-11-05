#!/usr/bin/env bun
import { join } from "node:path";
import { record } from "./record.ts";
import { render } from "./render.ts";
import { loadScript } from "./script.ts";
import type { Recording } from "./types.ts";

const USAGE = `Usage: opendemo <command> <script.json>

Commands:
  run      Record the script in a headless browser, then render the video
  record   Only record (raw frames and event log)
  render   Only render, from an earlier recording`;

const COMMANDS = ["run", "record", "render"] as const;
type Command = (typeof COMMANDS)[number];
const isCommand = (value: string | undefined): value is Command => COMMANDS.includes(value as Command);

const [command, scriptArg] = Bun.argv.slice(2);
if (!isCommand(command) || !scriptArg) {
  console.error(USAGE);
  process.exit(1);
}

const { script, outPath } = await loadScript(scriptArg);
const workDir = `${outPath}.opendemo`;

let rec: Recording;
if (command === "render") {
  rec = await Bun.file(join(workDir, "recording.json")).json();
} else {
  console.error(`Recording ${script.url}`);
  rec = await record(script, workDir);
  console.error(`Recorded ${(rec.duration / 1000).toFixed(1)}s, ${rec.frames.length} frames`);
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
