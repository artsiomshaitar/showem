import type { Subprocess } from "bun";
import { toolPath } from "./deps.ts";
import type { Size } from "./types.ts";

export async function expectSuccess(proc: Subprocess, what: string) {
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${what} exited with code ${code}`);
}

/**
 * Pipes raw RGBA frames into an H.264 encoder: constant quality, or `bitrate` Mbps when given.
 * The rate cap keeps every render part near the target, since parts are encoded separately.
 */
export function startEncoder(outPath: string, size: Size, fps: number, bitrate?: number) {
  const rate = bitrate === undefined
    ? ["-crf", "16"]
    : ["-b:v", `${bitrate}M`, "-maxrate", `${bitrate}M`, "-bufsize", `${bitrate * 2}M`];
  const proc = Bun.spawn(
    [
      toolPath("ffmpeg"), "-y", "-loglevel", "error",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${size.width}x${size.height}`, "-r", String(fps), "-i", "-",
      "-c:v", "libx264", "-preset", "veryfast", ...rate, "-pix_fmt", "yuv420p",
      outPath,
    ],
    { stdin: "pipe", stdout: "inherit", stderr: "inherit" },
  );
  return {
    async write(frame: Uint8Array | Uint8ClampedArray) {
      await proc.stdin.write(frame);
      await proc.stdin.flush();
    },
    async close() {
      await proc.stdin.end();
      await expectSuccess(proc, "ffmpeg");
    },
  };
}

/** A list file for ffmpeg's concat demuxer. Single quotes inside paths are escaped the way it expects. */
export function concatList(paths: readonly string[]) {
  return paths.map((p) => `file '${p.replaceAll("'", "'\\''")}'\n`).join("");
}

export async function concatVideos(parts: readonly string[], listPath: string, outPath: string) {
  await Bun.write(listPath, concatList(parts));
  const proc = Bun.spawn(
    [toolPath("ffmpeg"), "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outPath],
    { stdout: "inherit", stderr: "inherit" },
  );
  await expectSuccess(proc, "ffmpeg concat");
}
