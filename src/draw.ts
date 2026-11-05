import { basename } from "node:path";
import { createCanvas, loadImage, Path2D, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { Layout } from "./layout.ts";
import type { Caption } from "./plan.ts";
import type { Box, Point } from "./types.ts";

const CURSOR = new Path2D("M0 0 L0 17 L4.2 13.2 L7 19.6 L9.8 18.4 L7.1 12.2 L12.6 12.2 Z");
const CURSOR_PATH_HEIGHT = 20;
const CURSOR_HEIGHT = 24;
const CAPTION_FADE_MS = 180;
const UI_FONT = `"SF Pro Text", "Helvetica Neue", Arial, sans-serif`;
const CAPTION_FONT = `"SF Pro Display", "Helvetica Neue", Arial, sans-serif`;

export function roundedBox(ctx: SKRSContext2D, box: Box, radius: number) {
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.width, box.height, radius);
}

function cover(img: Image, width: number, height: number): Box {
  const s = Math.max(width / img.width, height / img.height);
  return { x: (width - img.width * s) / 2, y: (height - img.height * s) / 2, width: img.width * s, height: img.height * s };
}

/** The static part of every frame: background image and the window's shadow, drawn at `scale`× for sharp zooms. */
export async function drawBackdrop(layout: Layout, opts: { background?: string; shadow: number; radius: number; scale: number }): Promise<Canvas> {
  const canvas = createCanvas(layout.width * opts.scale, layout.height * opts.scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(opts.scale, opts.scale);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, layout.width, layout.height);
  if (opts.background) {
    const img = await loadImage(opts.background);
    const box = cover(img, layout.width, layout.height);
    ctx.drawImage(img, box.x, box.y, box.width, box.height);
  }
  if (opts.shadow > 0) {
    ctx.shadowColor = `rgba(0,0,0,${opts.shadow})`;
    ctx.shadowBlur = layout.height * 0.05;
    ctx.shadowOffsetY = layout.height * 0.015;
    ctx.fillStyle = "#000";
    roundedBox(ctx, layout.window, opts.radius);
    ctx.fill();
  }
  return canvas;
}

/** What the address bar shows: host and path for web pages, the file name for local files. */
export function urlLabel(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return basename(decodeURIComponent(u.pathname));
    return (u.host + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** A generic macOS-style toolbar: window buttons, back/forward, and the address bar. Sizes are in page pixels. */
export function drawToolbar(ctx: SKRSContext2D, layout: Layout, url: string) {
  const { window: win, toolbar, fit: u } = layout;
  const mid = win.y + toolbar / 2;
  ctx.fillStyle = "#f6f6f8";
  ctx.fillRect(win.x, win.y, win.width, toolbar);
  ctx.fillStyle = "#dcdce0";
  ctx.fillRect(win.x, win.y + toolbar - u, win.width, u);

  ["#ff5f57", "#febc2e", "#28c840"].forEach((color, i) => {
    ctx.beginPath();
    ctx.arc(win.x + (22 + i * 20) * u, mid, 6 * u, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  ctx.lineWidth = 2 * u;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const arrows = [{ x: 100, dir: -1, color: "#8e8e93" }, { x: 128, dir: 1, color: "#c7c7cc" }];
  for (const arrow of arrows) {
    const x = win.x + arrow.x * u;
    const d = arrow.dir * 4 * u;
    ctx.beginPath();
    ctx.moveTo(x - d, mid - 7 * u);
    ctx.lineTo(x + d, mid);
    ctx.lineTo(x - d, mid + 7 * u);
    ctx.strokeStyle = arrow.color;
    ctx.stroke();
  }

  const pillWidth = Math.min(win.width * 0.5, 600 * u);
  const pillHeight = 32 * u;
  ctx.fillStyle = "#e8e8ed";
  roundedBox(ctx, { x: win.x + (win.width - pillWidth) / 2, y: mid - pillHeight / 2, width: pillWidth, height: pillHeight }, 8 * u);
  ctx.fill();

  ctx.font = `500 ${13 * u}px ${UI_FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const label = urlLabel(url);
  const secure = url.startsWith("https:");
  const lockWidth = secure ? 14 * u : 0;
  let x = win.x + win.width / 2 - (ctx.measureText(label).width + lockWidth) / 2;
  if (secure) {
    ctx.fillStyle = ctx.strokeStyle = "#6e6e73";
    ctx.fillRect(x, mid - u, 8 * u, 6.5 * u);
    ctx.beginPath();
    ctx.arc(x + 4 * u, mid - u, 2.6 * u, Math.PI, 0);
    ctx.lineWidth = 1.5 * u;
    ctx.stroke();
    x += lockWidth;
  }
  ctx.fillStyle = "#3c3c43";
  ctx.fillText(label, x, mid);
}

/** Cursor size during a click: a quick press down, then a small overshoot back. */
export function pressScale(press: number) {
  if (press <= 0) return 1;
  if (press < 0.38) return 1 - 0.2 * Math.sin((Math.PI * press) / 0.38);
  return 1 + 0.1 * Math.sin((Math.PI * (press - 0.38)) / 0.62);
}

/** Draws the cursor tip at `at`. `zoom` is the camera scale already applied to `ctx`, since shadows ignore transforms. */
export function drawCursor(ctx: SKRSContext2D, at: Point, size: number, press: number, zoom: number) {
  const scale = (CURSOR_HEIGHT * size * pressScale(press)) / CURSOR_PATH_HEIGHT;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.scale(scale, scale);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 3 * scale * zoom;
  ctx.shadowOffsetY = scale * zoom;
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#fff";
  ctx.stroke(CURSOR);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#000";
  ctx.fill(CURSOR);
  ctx.restore();
}

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function drawCaption(ctx: SKRSContext2D, layout: Layout, caption: Caption, t: number, fontSize: number) {
  const alpha = Math.max(0, Math.min(1, (t - caption.start) / CAPTION_FADE_MS, (caption.end - t) / CAPTION_FADE_MS));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `600 ${fontSize}px ${CAPTION_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, caption.text, layout.page.width * 0.7);
  const lineHeight = fontSize * 1.3;
  const padX = fontSize * 0.8;
  const padY = fontSize * 0.5;
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
  const height = lines.length * lineHeight + padY * 2;
  const rise = (1 - alpha) * fontSize * 0.3;
  const box = { x: layout.width / 2 - width / 2, y: layout.page.y + layout.page.height - height - layout.height * 0.04 + rise, width, height };
  ctx.fillStyle = "rgba(10,10,14,0.72)";
  roundedBox(ctx, box, fontSize * 0.45);
  ctx.fill();
  ctx.fillStyle = "#fff";
  lines.forEach((l, i) => ctx.fillText(l, layout.width / 2, box.y + padY + lineHeight * (i + 0.5)));
  ctx.restore();
}
