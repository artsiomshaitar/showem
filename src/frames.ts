import { join } from "node:path";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { Camera } from "./camera.ts";
import { drawBackdrop, drawCaption, drawCursor, drawToolbar, roundedBox } from "./draw.ts";
import { startEncoder } from "./ffmpeg.ts";
import { layout as layoutOf, type Layout } from "./layout.ts";
import { plan as planOf, type Plan } from "./plan.ts";
import { outputOf, styleOf } from "./script.ts";
import { indexAt, itemAt } from "./timeline.ts";
import type { Recording, Script } from "./types.ts";

const MAX_BLUR_TAPS = 10;
const BLUR_PX_PER_TAP = 3;
const SOURCE_CACHE_SIZE = 4;

export interface FrameJob {
  script: Script;
  rec: Recording;
  dir: string;
  from: number;
  to: number;
  outPath: string;
}

function sourceFrames(rec: Recording, dir: string) {
  const cache = new Map<number, Image>();
  return async (t: number) => {
    const i = Math.max(0, indexAt(rec.frames, t));
    const frame = rec.frames[i];
    if (!frame) throw new Error("The recording has no frames");
    let img = cache.get(i);
    if (!img) {
      img = await loadImage(join(dir, "frames", frame.file));
      cache.set(i, img);
      for (const k of cache.keys()) if (k < i - SOURCE_CACHE_SIZE) cache.delete(k);
    }
    return img;
  };
}

/** How many sub-frames to blend for motion blur at `t`: more when the camera or cursor moves further during the shutter. */
function blurTaps(plan: Plan, layout: Layout, t: number, shutterMs: number, maxTaps: number) {
  if (maxTaps <= 1 || plan.isTyping(t)) return 1;
  const cam = plan.camera(t);
  const before = plan.camera(t - shutterMs);
  const a = plan.cursor(t);
  const b = plan.cursor(t - shutterMs);
  const cameraPx =
    Math.abs(Math.log(cam.scale / before.scale)) * layout.page.width +
    Math.hypot(cam.cx - before.cx, cam.cy - before.cy) * layout.page.width * cam.scale;
  const cursorPx = Math.hypot(a.x - b.x, a.y - b.y) * layout.fit * cam.scale;
  return Math.min(maxTaps, Math.max(1, Math.ceil(Math.max(cameraPx, cursorPx) / BLUR_PX_PER_TAP)));
}

/** Draws output frames `from`..`to` (exclusive) and encodes them to `outPath`. */
export async function renderFrames(job: FrameJob, onFrame?: () => void) {
  const { script, rec } = job;
  const layout = layoutOf(script, rec.viewport);
  const plan = planOf(script, rec);
  const style = styleOf(script);
  const { fps } = outputOf(script);
  const radius = style.radius * layout.height;
  const captionSize = style.captionSize ?? Math.round(layout.height * 0.03);
  const backdrop = await drawBackdrop(layout, { ...style, radius, scale: layout.height < 2160 ? 2 : 1 });
  const source = sourceFrames(rec, job.dir);

  async function drawScene(ctx: SKRSContext2D, frameT: number, t: number, cam: Camera) {
    const { page } = layout;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(layout.width / 2, layout.height / 2);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-(page.x + cam.cx * page.width), -(page.y + cam.cy * page.height));
    ctx.drawImage(backdrop, 0, 0, layout.width, layout.height);
    ctx.save();
    roundedBox(ctx, layout.window, radius);
    ctx.clip();
    drawToolbar(ctx, layout, itemAt(rec.urls, t)?.url ?? script.url);
    ctx.drawImage(await source(frameT), page.x, page.y, page.width, page.height);
    ctx.restore();
    const cursor = plan.cursor(t);
    const at = { x: page.x + (cursor.x / rec.viewport.width) * page.width, y: page.y + (cursor.y / rec.viewport.height) * page.height };
    drawCursor(ctx, at, style.cursorSize * layout.fit, cursor.press, cam.scale);
    ctx.restore();
  }

  const out = createCanvas(layout.width, layout.height);
  const outCtx = out.getContext("2d");
  const scene = createCanvas(layout.width, layout.height);
  const sceneCtx = scene.getContext("2d");
  const encoder = startEncoder(job.outPath, layout, fps);
  const frameMs = 1000 / fps;
  const shutterMs = style.motionBlur * frameMs * 2;
  const maxTaps = 1 + Math.round(style.motionBlur * (MAX_BLUR_TAPS - 1));

  for (let i = job.from; i < job.to; i++) {
    const t = i * frameMs;
    const taps = blurTaps(plan, layout, t, shutterMs, maxTaps);
    if (taps === 1) {
      await drawScene(outCtx, t, t, plan.camera(t));
    } else {
      for (let k = 0; k < taps; k++) {
        const tk = t - shutterMs * (1 - k / (taps - 1));
        await drawScene(sceneCtx, t, tk, plan.camera(tk));
        outCtx.globalAlpha = 1 / (k + 1);
        outCtx.drawImage(scene, 0, 0);
      }
      outCtx.globalAlpha = 1;
    }
    const caption = plan.captions.find((c) => t >= c.start && t < c.end);
    if (caption) drawCaption(outCtx, layout, caption, t, captionSize);
    await encoder.write(outCtx.getImageData(0, 0, layout.width, layout.height).data);
    onFrame?.();
  }
  await encoder.close();
}
