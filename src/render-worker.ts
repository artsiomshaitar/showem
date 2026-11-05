import { renderFrames, type FrameJob } from "./frames.ts";

const jobPath = Bun.argv[2];
if (!jobPath) throw new Error("Usage: render-worker <job.json>");

const job: FrameJob = await Bun.file(jobPath).json();
await renderFrames(job, () => process.stdout.write("."));
