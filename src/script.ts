import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { clamp } from "./geometry.ts";
import type { Script, Size, Step } from "./types.ts";

export const DEFAULT_VIEWPORT: Size = { width: 1440, height: 900 };
export const DEFAULT_ZOOM = 1.8;
const DEFAULT_HOLD_MS = 300;

export interface ZoomSpec {
  scale: number;
  holdMs: number;
  include: string[];
}

export function outputOf(script: Script) {
  return {
    width: script.output?.width ?? 2560,
    height: script.output?.height ?? 1440,
    fps: script.output?.fps ?? 60,
  };
}

export function styleOf(script: Script) {
  const style = script.style ?? {};
  return {
    background: style.background,
    padding: style.padding ?? 0.08,
    radius: style.radius ?? 0.018,
    shadow: clamp(style.shadow ?? 0.6, 0, 1),
    motionBlur: clamp(style.motionBlur ?? 0.5, 0, 1),
    cursorSize: style.cursor?.size ?? 1,
    travelMs: style.cursor?.travelMs ?? 800,
    captionSize: style.captions?.fontSize,
  };
}

export function zoomOf(step: Step): ZoomSpec | undefined {
  const zoom = "zoom" in step ? step.zoom : undefined;
  if (zoom === undefined || zoom === null || zoom === false) return undefined;
  if (zoom === true) return { scale: DEFAULT_ZOOM, holdMs: DEFAULT_HOLD_MS, include: [] };
  if (typeof zoom === "number") return { scale: zoom, holdMs: DEFAULT_HOLD_MS, include: [] };
  return { scale: zoom.scale ?? DEFAULT_ZOOM, holdMs: zoom.holdMs ?? DEFAULT_HOLD_MS, include: zoom.include ?? [] };
}

function resolveUrl(url: string, baseDir: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : pathToFileURL(resolve(baseDir, url)).href;
}

/** Resolves every relative path and URL in a script against the folder the script lives in. */
export function resolveScript(script: Script, scriptPath: string): { script: Script; outPath: string } {
  const dir = dirname(scriptPath);
  const fromDir = (path: string) => (isAbsolute(path) ? path : resolve(dir, path));
  const resolved: Script = {
    ...script,
    url: resolveUrl(script.url, dir),
    style: script.style && {
      ...script.style,
      background: script.style.background && fromDir(script.style.background),
    },
    steps: script.steps.map((step) => (step.action === "goto" ? { ...step, url: resolveUrl(step.url, dir) } : step)),
  };
  const outPath = fromDir(script.output?.path ?? `${basename(scriptPath, extname(scriptPath))}.mp4`);
  return { script: resolved, outPath };
}

export async function loadScript(path: string) {
  const scriptPath = resolve(path);
  return resolveScript(await Bun.file(scriptPath).json(), scriptPath);
}

/**
 * Identifies everything in the steps that changes what gets recorded. Captions and zoom scale only
 * change the render, so they are left out; `zoom.include` is kept because it is measured while recording.
 */
export function stepsKey(steps: readonly Step[]): string {
  return JSON.stringify(
    steps.map((step) => {
      const { caption: _caption, zoom: _zoom, ...fields }: Record<string, unknown> = { ...step };
      const include = zoomOf(step)?.include ?? [];
      const recorded = include.length ? { ...fields, include } : fields;
      return Object.fromEntries(Object.entries(recorded).sort(([a], [b]) => a.localeCompare(b)));
    }),
  );
}
