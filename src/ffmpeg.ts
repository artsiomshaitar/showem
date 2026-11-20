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

/**
 * Copies the video and adds a sound track with each clip starting at its time in ms.
 * Every clip is brought to the same loudness first, since a voice model can whisper one line and shout the next.
 * loudnorm leaves its frames with broken timestamps (each AAC frame then lasts one tick, and players lose the sound
 * after a seek), so they're counted again from the samples once the clip is in place. The track is padded with silence
 * to the end of the video: one that stops early crackles where it runs out.
 */
export async function addAudio(videoPath: string, clips: readonly { file: string; start: number }[], outPath: string) {
  const delayed = clips.map((c, i) => `[${i + 1}:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,adelay=${Math.round(c.start)}:all=1,asetpts=N/SR/TB[a${i}]`);
  const mix = `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0,apad[audio]`;
  const proc = Bun.spawn(
    [
      toolPath("ffmpeg"), "-y", "-loglevel", "error", "-i", videoPath, ...clips.flatMap((c) => ["-i", c.file]),
      "-filter_complex", [...delayed, mix].join(";"),
      "-map", "0:v", "-map", "[audio]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outPath,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  await expectSuccess(proc, "ffmpeg audio");
}

export async function concatVideos(parts: readonly string[], listPath: string, outPath: string) {
  await Bun.write(listPath, concatList(parts));
  const proc = Bun.spawn(
    [toolPath("ffmpeg"), "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outPath],
    { stdout: "inherit", stderr: "inherit" },
  );
  await expectSuccess(proc, "ffmpeg concat");
}
