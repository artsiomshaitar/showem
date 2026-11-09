import { renderFrames, type FrameJob } from "./frames.ts";

/** The hidden CLI command a compiled binary runs itself with to render one range of frames. */
export const RENDER_WORKER_COMMAND = "__render-worker";

export async function runRenderWorker(jobPath: string | undefined) {
  if (!jobPath) throw new Error("Usage: render-worker <job.json>");
  const job: FrameJob = await Bun.file(jobPath).json();
  await renderFrames(job, () => process.stdout.write("."));
}

if (import.meta.main) await runRenderWorker(Bun.argv[2]);
