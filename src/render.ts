import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ensureTool } from "./deps.ts";
import { concatVideos, expectSuccess } from "./ffmpeg.ts";
import type { FrameJob } from "./frames.ts";
import { assertRecordingMatches } from "./plan.ts";
import { RENDER_WORKER_COMMAND } from "./render-worker.ts";
import { outputOf } from "./script.ts";
import type { Recording, Script } from "./types.ts";

const MIN_FRAMES_PER_WORKER = 60;

/** A compiled binary has no source files on disk, so it runs itself with a hidden command instead. */
const isCompiled = import.meta.dir.startsWith("/$bunfs/");
const workerCommand = isCompiled ? [process.execPath, RENDER_WORKER_COMMAND] : ["bun", join(import.meta.dir, "render-worker.ts")];

export function frameCount(script: Script, rec: Recording) {
  return Math.ceil((rec.duration / 1000) * outputOf(script).fps);
}

/** Splits frames 0..total into at most `parts` contiguous, non-empty ranges of near-equal size. */
export function splitFrames(total: number, parts: number): [number, number][] {
  const count = Math.max(1, Math.min(parts, total));
  const size = Math.ceil(total / count);
  return Array.from({ length: Math.ceil(total / size) }, (_, k) => [k * size, Math.min(total, (k + 1) * size)]);
}

/**
 * Renders the video in parallel: each worker process draws and encodes one range of frames,
 * then the parts are joined without re-encoding. Workers are processes, not threads, because
 * the canvas library draws on only one thread at a time within a process.
 */
export async function render(script: Script, rec: Recording, dir: string, outPath: string, onProgress?: (done: number, total: number) => void) {
  assertRecordingMatches(script, rec);
  await ensureTool("ffmpeg");
  const total = frameCount(script, rec);
  const ranges = splitFrames(total, Math.min(navigator.hardwareConcurrency - 1, Math.ceil(total / MIN_FRAMES_PER_WORKER)));
  const partsDir = join(dir, "parts");
  await mkdir(partsDir, { recursive: true });

  const jobs: FrameJob[] = ranges.map(([from, to], k) => ({ script, rec, dir, from, to, outPath: join(partsDir, `${k}.mp4`) }));
  const workers = await Promise.all(jobs.map(async (job, k) => {
    const jobPath = join(partsDir, `${k}.json`);
    await Bun.write(jobPath, JSON.stringify(job));
    return Bun.spawn([...workerCommand, jobPath], { stdout: "pipe", stderr: "inherit" });
  }));

  let done = 0;
  try {
    await Promise.all(workers.map(async (proc, k) => {
      for await (const chunk of proc.stdout) {
        done += chunk.length;
        onProgress?.(done, total);
      }
      await expectSuccess(proc, `Render worker ${k}`);
    }));
  } catch (err) {
    for (const proc of workers) proc.kill();
    throw err;
  }

  await concatVideos(jobs.map((job) => job.outPath), join(partsDir, "list.txt"), outPath);
}
