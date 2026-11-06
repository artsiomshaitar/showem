import { basename } from "node:path";
import { createCanvas, loadImage, Path2D, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { Layout } from "./layout.ts";
import type { Caption } from "./plan.ts";
import { clamp } from "./geometry.ts";
import { easeInOutCubic } from "./motion.ts";
import { rowAt, rowBox } from "./menu.ts";
import type { Box, Menu, Point, Size } from "./types.ts";

const CURSOR = new Path2D("M0 0 L0 17 L4.2 13.2 L7 19.6 L9.8 18.4 L7.1 12.2 L12.6 12.2 Z");
const CURSOR_PATH_HEIGHT = 20;
const CURSOR_HEIGHT = 24;
const TAP_RADIUS = 20;
export const CAPTION_FADE_MS = 180;
const MENU_FADE_IN_MS = 120;
const MENU_FADE_OUT_MS = 100;
const IOS_MENU_GROW_MS = 200;
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

/** The background image behind every screen, drawn at `scale`× for sharp zooms. */
export async function drawBackground(size: Size, background: string | undefined, scale: number): Promise<Canvas> {
  const canvas = createCanvas(size.width * scale, size.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, size.width, size.height);
  if (background) {
    const img = await loadImage(background);
    const box = cover(img, size.width, size.height);
    ctx.drawImage(img, box.x, box.y, box.width, box.height);
  }
  return canvas;
}

/** The window's shadow on a transparent canvas covering `box`, so it can move with the window. */
export function drawShadow(layout: Layout, shadow: number, scale: number): { canvas: Canvas; box: Box } {
  const blur = layout.height * 0.05;
  const offsetY = layout.height * 0.015;
  const margin = blur * 1.5 + offsetY;
  const { window: win } = layout;
  const box = { x: win.x - margin, y: win.y - margin, width: win.width + 2 * margin, height: win.height + 2 * margin };
  const canvas = createCanvas(Math.ceil(box.width * scale), Math.ceil(box.height * scale));
  if (shadow <= 0) return { canvas, box };
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.translate(-box.x, -box.y);
  ctx.shadowColor = `rgba(0,0,0,${shadow})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = offsetY;
  ctx.fillStyle = "#000";
  roundedBox(ctx, win, layout.radius);
  ctx.fill();
  return { canvas, box };
}

/** The phone's body: drawn under the screen, which covers all of it but the bezel. */
export function drawPhoneBody(ctx: SKRSContext2D, layout: Layout) {
  const u = layout.fit;
  roundedBox(ctx, layout.window, layout.radius);
  ctx.fillStyle = "#1b1b1d";
  ctx.fill();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = "#4a4a4f";
  roundedBox(ctx, { x: layout.window.x + u, y: layout.window.y + u, width: layout.window.width - 2 * u, height: layout.window.height - 2 * u }, layout.radius - u);
  ctx.stroke();
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

/** What is drawn above the page for each frame. `top` and `bottom` are the colors at the page's top and bottom edges. */
export function drawChrome(ctx: SKRSContext2D, layout: Layout, url: string, edges: { top: string; bottom: string }) {
  if (layout.frame === "browser-safari") drawSafariToolbar(ctx, layout, url);
  else if (layout.frame === "browser-chrome") drawChromeToolbar(ctx, layout, url);
  else if (layout.frame === "mobile-iphone") drawStatusBar(ctx, layout, edges.top);
}

/** Drawn over the page: the iPhone home indicator. */
export function drawOverlay(ctx: SKRSContext2D, layout: Layout, edges: { top: string; bottom: string }) {
  if (layout.frame !== "mobile-iphone") return;
  const u = layout.fit;
  const { screen } = layout;
  ctx.fillStyle = isDark(edges.bottom) ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.85)";
  roundedBox(ctx, { x: screen.x + screen.width / 2 - 70 * u, y: screen.y + screen.height - 13 * u, width: 140 * u, height: 5 * u }, 2.5 * u);
  ctx.fill();
}

/** Whether a `rgb(r,g,b)` color is dark enough to need white text on it. */
export function isDark(color: string) {
  const [r = 255, g = 255, b = 255] = color.match(/\d+/g)?.map(Number) ?? [];
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

/** The iPhone status bar: time, dynamic island, signal and battery, over the page's top color. */
function drawStatusBar(ctx: SKRSContext2D, layout: Layout, background: string) {
  const u = layout.fit;
  const { screen } = layout;
  const ink = isDark(background) ? "#fff" : "#000";
  const mid = screen.y + 29 * u;
  ctx.fillStyle = background;
  ctx.fillRect(screen.x, screen.y, screen.width, layout.toolbar);

  ctx.fillStyle = "#000";
  roundedBox(ctx, { x: screen.x + screen.width / 2 - 62.5 * u, y: screen.y + 11 * u, width: 125 * u, height: 37 * u }, 18.5 * u);
  ctx.fill();

  ctx.fillStyle = ink;
  ctx.font = `600 ${17 * u}px ${UI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("9:41", screen.x + 66 * u, mid);

  const right = screen.x + screen.width - 30 * u;
  for (let i = 0; i < 4; i++) {
    const h = (4 + i * 2.6) * u;
    roundedBox(ctx, { x: right - 72 * u + i * 4.8 * u, y: mid + 5.5 * u - h, width: 3.2 * u, height: h }, 0.8 * u);
    ctx.fill();
  }
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1 * u;
  roundedBox(ctx, { x: right - 25 * u, y: mid - 6 * u, width: 25 * u, height: 12 * u }, 3.5 * u);
  ctx.stroke();
  ctx.fillRect(right + 1.5 * u, mid - 2 * u, 1.5 * u, 4 * u);
  ctx.globalAlpha = 1;
  roundedBox(ctx, { x: right - 23 * u, y: mid - 4 * u, width: 18 * u, height: 8 * u }, 2 * u);
  ctx.fill();
}

/** A Chrome-style window: tab strip with one tab, then back/forward/reload and the address bar. Sizes are in page pixels. */
function drawChromeToolbar(ctx: SKRSContext2D, layout: Layout, url: string) {
  const { window: win, fit: u } = layout;
  const strip = 40 * u;
  const mid = win.y + strip + (layout.toolbar - strip) / 2;
  ctx.fillStyle = "#dfe3e8";
  ctx.fillRect(win.x, win.y, win.width, strip);
  ctx.fillStyle = "#fff";
  ctx.fillRect(win.x, win.y + strip, win.width, layout.toolbar - strip);
  ctx.fillStyle = "#dadce0";
  ctx.fillRect(win.x, win.y + layout.toolbar - u, win.width, u);

  ["#ff5f57", "#febc2e", "#28c840"].forEach((color, i) => {
    ctx.beginPath();
    ctx.arc(win.x + (22 + i * 20) * u, win.y + strip / 2, 6 * u, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  const tab = { x: win.x + 86 * u, y: win.y + 7 * u, width: Math.min(240 * u, win.width * 0.3), height: strip - 7 * u };
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(tab.x, tab.y, tab.width, tab.height + u, [10 * u, 10 * u, 0, 0]);
  ctx.fill();
  ctx.fillStyle = "#5f6368";
  ctx.beginPath();
  ctx.arc(tab.x + 18 * u, tab.y + tab.height / 2, 6 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.rect(tab.x + 32 * u, tab.y, tab.width - 44 * u, tab.height);
  ctx.clip();
  ctx.fillStyle = "#202124";
  ctx.font = `500 ${12.5 * u}px ${UI_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(urlLabel(url).split("/")[0] ?? "", tab.x + 32 * u, tab.y + tab.height / 2);
  ctx.restore();
  ctx.strokeStyle = "#5f6368";
  ctx.lineWidth = 1.6 * u;
  ctx.lineCap = "round";
  const plus = { x: tab.x + tab.width + 20 * u, y: tab.y + tab.height / 2 };
  ctx.beginPath();
  ctx.moveTo(plus.x - 6 * u, plus.y);
  ctx.lineTo(plus.x + 6 * u, plus.y);
  ctx.moveTo(plus.x, plus.y - 6 * u);
  ctx.lineTo(plus.x, plus.y + 6 * u);
  ctx.stroke();

  ctx.lineWidth = 2 * u;
  ctx.lineJoin = "round";
  for (const [x, dir, color] of [[22, 1, "#5f6368"], [52, -1, "#bdc1c6"]] as const) {
    const cx = win.x + x * u;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - 7 * u * dir, mid);
    ctx.lineTo(cx + 7 * u * dir, mid);
    ctx.moveTo(cx - 1 * u * dir, mid - 6 * u);
    ctx.lineTo(cx - 7 * u * dir, mid);
    ctx.lineTo(cx - 1 * u * dir, mid + 6 * u);
    ctx.stroke();
  }
  ctx.strokeStyle = "#5f6368";
  ctx.beginPath();
  ctx.arc(win.x + 82 * u, mid, 6.5 * u, -Math.PI * 0.35, Math.PI * 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(win.x + 82 * u, mid - 9.5 * u);
  ctx.lineTo(win.x + 86 * u, mid - 6.5 * u);
  ctx.lineTo(win.x + 82 * u, mid - 3.5 * u);
  ctx.stroke();

  const bar = { x: win.x + 104 * u, y: mid - 17 * u, width: win.width - 150 * u, height: 34 * u };
  ctx.fillStyle = "#f1f3f4";
  roundedBox(ctx, bar, 17 * u);
  ctx.fill();
  ctx.fillStyle = "#202124";
  ctx.font = `400 ${14 * u}px ${UI_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(urlLabel(url), bar.x + 18 * u, mid);

  ctx.fillStyle = "#5f6368";
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(win.x + win.width - 24 * u, mid + i * 5.5 * u, 1.8 * u, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A Safari-style toolbar: window buttons, back/forward, and the address bar. Sizes are in page pixels. */
function drawSafariToolbar(ctx: SKRSContext2D, layout: Layout, url: string) {
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

/**
 * A native select's open menu, in page coordinates: like the one Chrome shows on macOS, or on a phone (`menu.ios`) like
 * iPhone Safari's, which grows out of the select as it opens. The row under `pointer` is highlighted, and the check mark
 * moves to the chosen row once the menu starts to close.
 */
export function drawMenu(ctx: SKRSContext2D, menu: Menu, t: number, pointer: Point) {
  const alpha = clamp(Math.min((t - menu.openAt) / MENU_FADE_IN_MS, (menu.closeAt - t) / MENU_FADE_OUT_MS), 0, 1);
  if (alpha <= 0) return;
  const { box, fontSize, ios } = menu;
  const checked = t >= menu.closeAt - MENU_FADE_OUT_MS ? menu.to : menu.from;
  const hovered = rowAt(menu, pointer);
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (ios) {
    const grow = 0.9 + 0.1 * easeInOutCubic(clamp((t - menu.openAt) / IOS_MENU_GROW_MS, 0, 1));
    ctx.translate(box.x, box.y);
    ctx.scale(grow, grow);
    ctx.translate(-box.x, -box.y);
  }
  ctx.shadowColor = ios ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.22)";
  ctx.shadowBlur = ios ? 30 : 16;
  ctx.shadowOffsetY = ios ? 10 : 6;
  ctx.fillStyle = ios ? "#f9f9f9" : "#fff";
  roundedBox(ctx, box, ios ? 13 : 7);
  ctx.fill();
  ctx.shadowColor = "transparent";
  if (!ios) {
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.stroke();
  }
  ctx.clip();
  ctx.font = `400 ${fontSize}px ${UI_FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const indent = ios ? fontSize * 2.3 : fontSize * 1.5;
  menu.options.forEach((label, i) => {
    const row = rowBox(menu, i);
    const mid = row.y + row.height / 2;
    if (ios) {
      // Full-width rows split by hairlines, and a gray press highlight.
      if (i > 0) {
        ctx.fillStyle = "rgba(60,60,67,0.2)";
        ctx.fillRect(box.x, row.y, box.width, 0.5);
      }
      if (i === hovered) {
        ctx.fillStyle = "rgba(0,0,0,0.1)";
        ctx.fillRect(box.x, row.y, box.width, row.height);
      }
    } else if (i === hovered) {
      ctx.fillStyle = "#0a64d8";
      roundedBox(ctx, row, 4);
      ctx.fill();
    }
    ctx.fillStyle = ctx.strokeStyle = ios ? "#000" : i === hovered ? "#fff" : "#1d1d1f";
    if (i === checked) {
      const x = row.x + fontSize * (ios ? 0.6 : 0.45);
      ctx.lineWidth = fontSize * 0.12;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x, mid);
      ctx.lineTo(x + fontSize * 0.25, mid + fontSize * 0.25);
      ctx.lineTo(x + fontSize * 0.65, mid - fontSize * 0.3);
      ctx.stroke();
    }
    ctx.fillText(label, row.x + indent, mid);
  });
  ctx.restore();
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

/** A soft circle where a finger touches. `size` is canvas pixels per page pixel, like the cursor's. */
export function drawTap(ctx: SKRSContext2D, at: Point, size: number, press: number, zoom: number) {
  const r = TAP_RADIUS * size * pressScale(press);
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 6 * size * zoom;
  ctx.fillStyle = "rgba(60,60,67,0.3)";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 2.5 * size;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
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
  const lines = wrap(ctx, caption.text, Math.min(layout.width, layout.height) * 0.9);
  const lineHeight = fontSize * 1.3;
  const padX = fontSize * 0.8;
  const padY = fontSize * 0.5;
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
  const height = lines.length * lineHeight + padY * 2;
  const rise = (1 - alpha) * fontSize * 0.3;
  // Placed by the canvas, not the window, so it stays put while the video switches screens.
  const box = { x: layout.width / 2 - width / 2, y: layout.height - layout.padding - height - layout.height * 0.04 + rise, width, height };
  ctx.fillStyle = "rgba(10,10,14,0.72)";
  roundedBox(ctx, box, fontSize * 0.45);
  ctx.fill();
  ctx.fillStyle = "#fff";
  lines.forEach((l, i) => ctx.fillText(l, layout.width / 2, box.y + padY + lineHeight * (i + 0.5)));
  ctx.restore();
}
