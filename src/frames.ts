import { join } from "node:path";
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { Camera } from "./camera.ts";
import { drawBackground, drawCaption, drawChrome, drawCursor, drawMenu, drawOverlay, drawPhoneBody, drawShadow, drawTap, roundedBox } from "./draw.ts";
import { startEncoder } from "./ffmpeg.ts";
import type { Layout } from "./layout.ts";
import { easeInOutCubic, springEase } from "./motion.ts";
import { plan as planOf, type Scene, type ScreenPlan } from "./plan.ts";
import { outputOf, styleOf } from "./script.ts";
import { indexAt, itemAt } from "./timeline.ts";
import type { Box, Menu, Point, Recording, ScreenRecording, Script } from "./types.ts";

const MAX_BLUR_TAPS = 10;
const BLUR_PX_PER_TAP = 3;
const SOURCE_CACHE_SIZE = 4;
/** Below this camera movement during the shutter (canvas pixels), motion blur only blends the pointer. */
const STILL_CAMERA_PX = 0.5;
/** Room around the pointer's tip for its shape and shadow, in cursor sizes (page pixels at size 1). */
const POINTER_MARGIN = 40;

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

/** The background with a screen's window shadow on it, drawn as one image. */
function drawBackdrop(background: Canvas, shadow: { canvas: Canvas; box: Box }, scale: number) {
  const canvas = createCanvas(background.width, background.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(background, 0, 0);
  const { box } = shadow;
  ctx.drawImage(shadow.canvas, box.x * scale, box.y * scale, box.width * scale, box.height * scale);
  return canvas;
}

/** The page canvas point `cam` puts at the center of the output. */
const cameraCenter = (layout: Layout, cam: Camera): Point => ({ x: layout.page.x + cam.cx * layout.page.width, y: layout.page.y + cam.cy * layout.page.height });

/** Whether the camera is zoomed in so far that the window, inside its rounded corners, covers the whole frame. */
export function fillsView(layout: Layout, cam: Camera, width: number, height: number) {
  const { window: win, radius } = layout;
  const { x, y } = cameraCenter(layout, cam);
  const halfWidth = width / (2 * cam.scale);
  const halfHeight = height / (2 * cam.scale);
  return x - halfWidth >= win.x + radius && x + halfWidth <= win.x + win.width - radius && y - halfHeight >= win.y + radius && y + halfHeight <= win.y + win.height - radius;
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

/** How many sub-frames to blend for motion blur at `t` (more when the camera or cursor moves further during the shutter), and how far the camera moved, in canvas pixels. */
function blurTaps(plan: ScreenPlan, layout: Layout, t: number, shutterMs: number, maxTaps: number) {
  if (maxTaps <= 1 || plan.isTyping(t)) return { taps: 1, cameraPx: 0 };
  const cam = plan.camera(t);
  const before = plan.camera(t - shutterMs);
  const a = plan.cursor(t);
  const b = plan.cursor(t - shutterMs);
  const cameraPx =
    Math.abs(Math.log(cam.scale / before.scale)) * layout.page.width +
    Math.hypot(cam.cx - before.cx, cam.cy - before.cy) * layout.page.width * cam.scale;
  const cursorPx = plan.touch ? 0 : Math.hypot(a.x - b.x, a.y - b.y) * layout.fit * cam.scale;
  return { taps: Math.min(maxTaps, Math.max(1, Math.ceil(Math.max(cameraPx, cursorPx) / BLUR_PX_PER_TAP))), cameraPx };
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
  const screens = new Map<string, ScreenPlan & { rec: ScreenRecording; shadow: ReturnType<typeof drawShadow>; backdrop: Canvas; source: (t: number) => Promise<Image>; menus: Menu[] }>();
  for (const [name, screenPlan] of Object.entries(plan.screens)) {
    const screenRec = rec.screens[name]!;
    const shadow = drawShadow(screenPlan.layout, style.shadow, detail);
    const menus = rec.steps.flatMap((log) => (log.screen === name && log.menu ? [log.menu] : []));
    screens.set(name, { ...screenPlan, rec: screenRec, shadow, backdrop: drawBackdrop(background, shadow, detail), source: sourceFrames(screenRec, job.dir), menus });
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
    applyCamera(ctx, layout, cam, opts.dx);
    // Both are soft and only shrunk or enlarged here, where the cheapest filter looks the same and is several times faster.
    ctx.imageSmoothingQuality = "low";
    if (opts.dx !== undefined) {
      const { canvas: shadow, box } = screen.shadow;
      ctx.drawImage(shadow, box.x, box.y, box.width, box.height);
    } else if (!fillsView(layout, cam, width, height)) {
      ctx.drawImage(screen.backdrop, 0, 0, width, height);
    }
    ctx.imageSmoothingQuality = "high";
    if (screen.touch) drawPhoneBody(ctx, layout);
    ctx.save();
    roundedBox(ctx, layout.screen, layout.screenRadius);
    ctx.clip();
    const img = await screen.source(frameT);
    const pageEdges = screen.touch ? edges(img) : { top: "", bottom: "" };
    drawChrome(ctx, layout, itemAt(screen.rec.urls, t)?.url ?? "", pageEdges);
    ctx.drawImage(img, page.x, page.y, page.width, page.height);
    const { viewport } = screen.rec;
    const menu = screen.menus.find((m) => t >= m.openAt && t < m.closeAt);
    if (menu) {
      ctx.save();
      ctx.translate(page.x, page.y);
      ctx.scale(page.width / viewport.width, page.height / viewport.height);
      drawMenu(ctx, menu, t, screen.cursor(t));
      ctx.restore();
    }
    drawOverlay(ctx, layout, pageEdges);
    ctx.restore();
    if (opts.pointer > 0) drawPointer(ctx, name, t, opts.pointer);
    ctx.restore();
  }

  /** Where a page point lands on the page canvas, before the camera. */
  function onPage(name: string, p: Point): Point {
    const { layout, rec: screenRec } = screenOf(name);
    const { page } = layout;
    return { x: page.x + (p.x / screenRec.viewport.width) * page.width, y: page.y + (p.y / screenRec.viewport.height) * page.height };
  }

  /** The cursor or tap at `t`, on a context already set up with the screen's camera. */
  function drawPointer(ctx: SKRSContext2D, name: string, t: number, alpha: number) {
    const screen = screenOf(name);
    const size = style.cursorSize * screen.layout.fit;
    const { scale } = screen.camera(t);
    if (screen.touch) {
      const tap = screen.tap(t);
      if (!tap) return;
      ctx.globalAlpha = tap.alpha * alpha;
      drawTap(ctx, onPage(name, tap), size, tap.press, scale);
    } else {
      const cursor = screen.cursor(t);
      ctx.globalAlpha = alpha;
      drawCursor(ctx, onPage(name, cursor), size, cursor.press, scale);
    }
  }

  /** Sets `ctx` up to draw page canvas points through `cam`, moved `dx` output pixels sideways. */
  function applyCamera(ctx: SKRSContext2D, layout: Layout, cam: Camera, dx = 0) {
    const center = cameraCenter(layout, cam);
    ctx.translate(width / 2 + dx, height / 2);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-center.x, -center.y);
  }

  /**
   * Motion blur when only the pointer moves: the page is drawn once, and only the area the pointer
   * crosses is blended, the same way `blend` blends whole frames. Every sub-frame already shows the
   * same page image, so nothing else in the picture changes.
   */
  async function blendPointer(name: string, t: number, taps: number) {
    const screen = screenOf(name);
    const cam = screen.camera(t);
    await drawScene(sceneCtx, name, t, t, cam, { pointer: 0 });
    outCtx.drawImage(scene, 0, 0);
    const times = Array.from({ length: taps }, (_, k) => t - shutterMs * (1 - k / (taps - 1)));
    const center = cameraCenter(screen.layout, cam);
    const tips = times.map((tk) => {
      const p = onPage(name, screen.cursor(tk));
      return { x: width / 2 + cam.scale * (p.x - center.x), y: height / 2 + cam.scale * (p.y - center.y) };
    });
    // The cursor and its shadow stay well inside this margin around its tip.
    const margin = Math.ceil(POINTER_MARGIN * style.cursorSize * screen.layout.fit * cam.scale);
    const x = Math.max(0, Math.floor(Math.min(...tips.map((p) => p.x)) - margin));
    const y = Math.max(0, Math.floor(Math.min(...tips.map((p) => p.y)) - margin));
    const w = Math.min(width, Math.ceil(Math.max(...tips.map((p) => p.x)) + margin)) - x;
    const h = Math.min(height, Math.ceil(Math.max(...tips.map((p) => p.y)) + margin)) - y;
    if (w <= 0 || h <= 0) return;
    for (let k = 0; k < taps; k++) {
      patchCtx.globalAlpha = 1;
      patchCtx.drawImage(scene, x, y, w, h, x, y, w, h);
      patchCtx.save();
      applyCamera(patchCtx, screen.layout, cam);
      drawPointer(patchCtx, name, times[k]!, 1);
      patchCtx.restore();
      outCtx.globalAlpha = 1 / (k + 1);
      outCtx.drawImage(patch, x, y, w, h, x, y, w, h);
    }
    outCtx.globalAlpha = 1;
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
  const patch = createCanvas(width, height);
  const patchCtx = patch.getContext("2d");
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
      const { taps, cameraPx } = blurTaps(screen, screen.layout, t, shutterMs, maxTaps);
      // A drawn menu highlights the row under the pointer, so it changes with the pointer and needs whole frames.
      const menuOpen = screen.menus.some((m) => t - shutterMs < m.closeAt && t >= m.openAt);
      if (taps > 1 && !menuOpen && cameraPx < STILL_CAMERA_PX) await blendPointer(now.screen, t, taps);
      else await blend(t, taps, (ctx, tk) => drawScene(ctx, now.screen, t, tk, screen.camera(tk), { pointer: 1 }));
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
