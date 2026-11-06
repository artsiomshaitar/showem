import { join } from "node:path";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { Camera } from "./camera.ts";
import { drawBackground, drawCaption, drawChrome, drawCursor, drawOverlay, drawPhoneBody, drawShadow, drawTap, roundedBox } from "./draw.ts";
import { startEncoder } from "./ffmpeg.ts";
import type { Layout } from "./layout.ts";
import { easeInOutCubic, springEase } from "./motion.ts";
import { plan as planOf, type Scene, type ScreenPlan } from "./plan.ts";
import { outputOf, styleOf } from "./script.ts";
import { indexAt, itemAt } from "./timeline.ts";
import type { Point, Recording, ScreenRecording, Script } from "./types.ts";

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

function sourceFrames(rec: ScreenRecording, dir: string) {
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

/** The colors along the top and bottom edges of a page frame, for the phone's status bar and home indicator. */
function edgeColors(): (img: Image) => { top: string; bottom: string } {
  const probe = createCanvas(1, 2);
  const ctx = probe.getContext("2d");
  const cache = new WeakMap<Image, { top: string; bottom: string }>();
  return (img) => {
    let edges = cache.get(img);
    if (!edges) {
      ctx.drawImage(img, 0, 0, img.width, 6, 0, 0, 1, 1);
      ctx.drawImage(img, 0, img.height - 6, img.width, 6, 0, 1, 1, 1);
      const [r1, g1, b1, , r2, g2, b2] = ctx.getImageData(0, 0, 1, 2).data;
      edges = { top: `rgb(${r1},${g1},${b1})`, bottom: `rgb(${r2},${g2},${b2})` };
      cache.set(img, edges);
    }
    return edges;
  };
}

/** How many sub-frames to blend for motion blur at `t`: more when the camera or cursor moves further during the shutter. */
function blurTaps(plan: ScreenPlan, layout: Layout, t: number, shutterMs: number, maxTaps: number) {
  if (maxTaps <= 1 || plan.isTyping(t)) return 1;
  const cam = plan.camera(t);
  const before = plan.camera(t - shutterMs);
  const a = plan.cursor(t);
  const b = plan.cursor(t - shutterMs);
  const cameraPx =
    Math.abs(Math.log(cam.scale / before.scale)) * layout.page.width +
    Math.hypot(cam.cx - before.cx, cam.cy - before.cy) * layout.page.width * cam.scale;
  const cursorPx = plan.touch ? 0 : Math.hypot(a.x - b.x, a.y - b.y) * layout.fit * cam.scale;
  return Math.min(maxTaps, Math.max(1, Math.ceil(Math.max(cameraPx, cursorPx) / BLUR_PX_PER_TAP)));
}

type Change = Exclude<Scene, { screen: string }>;

/** Draws output frames `from`..`to` (exclusive) and encodes them to `outPath`. */
export async function renderFrames(job: FrameJob, onFrame?: () => void) {
  const { script, rec } = job;
  const plan = planOf(script, rec);
  const style = styleOf(script);
  const { fps } = outputOf(script);
  const edges = edgeColors();
  const anyLayout = plan.screens[rec.firstScreen]!.layout;
  const { width, height } = anyLayout;
  const detail = height < 2160 ? 2 : 1;
  const background = await drawBackground(anyLayout, style.background, detail);
  const screens = new Map<string, ScreenPlan & { rec: ScreenRecording; shadow: ReturnType<typeof drawShadow>; source: (t: number) => Promise<Image> }>();
  for (const [name, screenPlan] of Object.entries(plan.screens)) {
    const screenRec = rec.screens[name]!;
    const shadow = drawShadow(screenPlan.layout, style.shadow, detail);
    screens.set(name, { ...screenPlan, rec: screenRec, shadow, source: sourceFrames(screenRec, job.dir) });
  }
  const screenOf = (name: string) => screens.get(name)!;
  const captionSize = style.captionSize ?? Math.round(height * 0.03);

  /**
   * Draws one screen through its camera. `dx` moves the window sideways (canvas pixels), leaving the background out.
   * `pointer` is the pointer's opacity: during a switch each screen's pointer only fades, staying put and keeping its shape.
   */
  async function drawScene(ctx: SKRSContext2D, name: string, frameT: number, t: number, cam: Camera, opts: { pointer: number; dx?: number }) {
    const screen = screenOf(name);
    const { layout } = screen;
    const { page } = layout;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(width / 2 + (opts.dx ?? 0), height / 2);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-(page.x + cam.cx * page.width), -(page.y + cam.cy * page.height));
    if (opts.dx === undefined) ctx.drawImage(background, 0, 0, width, height);
    const { canvas: shadow, box } = screen.shadow;
    ctx.drawImage(shadow, box.x, box.y, box.width, box.height);
    if (screen.touch) drawPhoneBody(ctx, layout);
    ctx.save();
    roundedBox(ctx, layout.screen, layout.screenRadius);
    ctx.clip();
    const img = await screen.source(frameT);
    const pageEdges = screen.touch ? edges(img) : { top: "", bottom: "" };
    drawChrome(ctx, layout, itemAt(screen.rec.urls, t)?.url ?? "", pageEdges);
    ctx.drawImage(img, page.x, page.y, page.width, page.height);
    drawOverlay(ctx, layout, pageEdges);
    ctx.restore();
    const { viewport } = screen.rec;
    const onPage = (p: Point) => ({ x: page.x + (p.x / viewport.width) * page.width, y: page.y + (p.y / viewport.height) * page.height });
    const size = style.cursorSize * layout.fit;
    if (opts.pointer > 0 && screen.touch) {
      const tap = screen.tap(t);
      if (tap) {
        ctx.globalAlpha = tap.alpha * opts.pointer;
        drawTap(ctx, onPage(tap), size, tap.press, cam.scale);
      }
    } else if (opts.pointer > 0) {
      const cursor = screen.cursor(t);
      ctx.globalAlpha = opts.pointer;
      drawCursor(ctx, onPage(cursor), size, cursor.press, cam.scale);
    }
    ctx.restore();
  }

  /** How far the outgoing and incoming windows are moved sideways during a slide. */
  function slideOffsets(change: Change): [number, number] {
    if (change.transition !== "slide") return [0, 0];
    const e = springEase(change.k);
    const distance = change.direction * width;
    return [-distance * e, distance * (1 - e)];
  }

  /** A slide: the background stays put while one window moves out and the other moves in. */
  async function drawSlide(ctx: SKRSContext2D, change: Change, frameT: number, t: number) {
    const [dxA, dxB] = slideOffsets(change);
    const e = easeInOutCubic(change.k);
    ctx.drawImage(background, 0, 0, width, height);
    const fromT = change.fromAt ?? t;
    await drawScene(ctx, change.from, change.fromAt ?? frameT, fromT, screenOf(change.from).camera(fromT), { pointer: 1 - e, dx: dxA });
    await drawScene(ctx, change.to, frameT, t, screenOf(change.to).camera(t), { pointer: e, dx: dxB });
  }

  const out = createCanvas(width, height);
  const outCtx = out.getContext("2d");
  const scene = createCanvas(width, height);
  const sceneCtx = scene.getContext("2d");
  const encoder = startEncoder(job.outPath, anyLayout, fps);
  const frameMs = 1000 / fps;
  const shutterMs = style.motionBlur * frameMs * 2;
  const maxTaps = 1 + Math.round(style.motionBlur * (MAX_BLUR_TAPS - 1));

  /** Blends `taps` sub-frames across the shutter into `outCtx`, or draws one frame straight into it. */
  async function blend(t: number, taps: number, draw: (ctx: SKRSContext2D, t: number) => Promise<void>) {
    if (taps === 1) return draw(outCtx, t);
    for (let k = 0; k < taps; k++) {
      await draw(sceneCtx, t - shutterMs * (1 - k / (taps - 1)));
      outCtx.globalAlpha = 1 / (k + 1);
      outCtx.drawImage(scene, 0, 0);
    }
    outCtx.globalAlpha = 1;
  }

  for (let i = job.from; i < job.to; i++) {
    const t = i * frameMs;
    const now = plan.scene(t);
    if ("screen" in now) {
      const screen = screenOf(now.screen);
      const taps = blurTaps(screen, screen.layout, t, shutterMs, maxTaps);
      await blend(t, taps, (ctx, tk) => drawScene(ctx, now.screen, t, tk, screen.camera(tk), { pointer: 1 }));
    } else if (now.transition === "slide") {
      const before = plan.scene(t - shutterMs);
      const moved = Math.abs(slideOffsets(now)[0] - ("screen" in before ? 0 : slideOffsets(before)[0]));
      const taps = maxTaps <= 1 ? 1 : Math.min(maxTaps, Math.max(1, Math.ceil(moved / BLUR_PX_PER_TAP)));
      await blend(t, taps, async (ctx, tk) => {
        const at = plan.scene(tk);
        await drawSlide(ctx, "screen" in at ? { ...now, k: 0 } : at, t, tk);
      });
    } else {
      const fromT = now.fromAt ?? t;
      await drawScene(outCtx, now.from, fromT, fromT, screenOf(now.from).camera(fromT), { pointer: 1 });
      await drawScene(sceneCtx, now.to, t, t, screenOf(now.to).camera(t), { pointer: 1 });
      outCtx.globalAlpha = easeInOutCubic(now.k);
      outCtx.drawImage(scene, 0, 0);
      outCtx.globalAlpha = 1;
    }
    const caption = plan.captions.find((c) => t >= c.start && t < c.end);
    if (caption) drawCaption(outCtx, anyLayout, caption, t, captionSize);
    await encoder.write(outCtx.getImageData(0, 0, width, height).data);
    onFrame?.();
  }
  await encoder.close();
}
