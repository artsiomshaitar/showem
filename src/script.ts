import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PHONE_VIEWPORT } from "./device.ts";
import { clamp } from "./geometry.ts";
import { FRAMES, TRANSITIONS, type FrameKind, type Script, type Size, type Step } from "./types.ts";

export const DEFAULT_VIEWPORT: Size = { width: 1440, height: 900 };
export const DEFAULT_FRAME: FrameKind = "browser-safari";
const SINGLE_SCREEN = "main";
const VAR = /\$\{(\w+)\}/g;
const ACTIONS: readonly string[] = ["goto", "click", "hover", "type", "press", "scroll", "wait-for", "wait", "pause-recording", "resume-recording", "switch", "save"] satisfies Step["action"][];
const RENAMED = new Map([["pause", "wait"], ["waitFor", "wait-for"]]);
/** Step options that only change how the video looks, not what the browser does. */
const VISUAL_OPTIONS = ["caption", "zoom", "transition"] as const;

export interface Screen {
  url: string;
  frame: FrameKind;
  viewport: Size;
}

export const isPhone = (frame: FrameKind) => frame.startsWith("mobile-");

/** Every screen with its defaults filled in. A script without `screens` has one screen. */
export function screensOf(script: Script): Record<string, Screen> {
  const options = script.screens ?? { [SINGLE_SCREEN]: { url: script.url ?? "" } };
  return Object.fromEntries(
    Object.entries(options).map(([name, o]) => {
      const frame = o.frame ?? DEFAULT_FRAME;
      const viewport = isPhone(frame) ? PHONE_VIEWPORT : (o.viewport ?? script.viewport ?? DEFAULT_VIEWPORT);
      return [name, { url: o.url, frame, viewport }];
    }),
  );
}

/** Replaces each `${name}` in `text` with its saved value. */
export function fillVars(text: string, vars: Readonly<Record<string, string>>) {
  return text.replace(VAR, (_, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`\${${name}} is used before a save step stores it`);
    return value;
  });
}

/** The step with `${name}` filled in, in every text field. */
export function fillStep(step: Step, vars: Readonly<Record<string, string>>): Step {
  return JSON.parse(JSON.stringify(step), (key, value) => (typeof value === "string" && key !== "action" ? fillVars(value, vars) : value));
}

/** Catches mistakes before the browser starts: unknown screens or frames, and values used before they are saved. */
export function checkScript(script: Script) {
  if (!script.screens && !script.url) throw new Error("The script needs a `url` or `screens`");
  if (script.screens && !Object.keys(script.screens).length) throw new Error("`screens` is empty");
  const screens = screensOf(script);
  for (const [name, screen] of Object.entries(script.screens ?? {})) {
    if (!/^[A-Za-z][\w-]*$/.test(name)) throw new Error(`Screen name "${name}" must start with a letter and use only letters, digits, - and _`);
    if (screen.frame && !FRAMES.includes(screen.frame)) throw new Error(`Screen "${name}": unknown frame "${screen.frame}". Use one of: ${FRAMES.join(", ")}`);
  }
  const saved = new Set<string>();
  let pausedAt: number | undefined;
  script.steps.forEach((step, i) => {
    const where = `Step ${i + 1} (${step.action})`;
    const renamed = RENAMED.get(step.action);
    if (renamed) throw new Error(`${where}: "${step.action}" is now "${renamed}"`);
    if (!ACTIONS.includes(step.action)) throw new Error(`${where}: unknown action. Use one of: ${ACTIONS.join(", ")}`);
    if (step.action === "pause-recording" && pausedAt !== undefined) throw new Error(`${where}: recording is already paused at step ${pausedAt + 1}`);
    if (step.action === "resume-recording" && pausedAt === undefined) throw new Error(`${where}: recording is not paused`);
    if (step.action === "pause-recording") pausedAt = i;
    if (step.action === "resume-recording") pausedAt = undefined;
    if (step.action === "switch" && !screens[step.screen]) throw new Error(`${where}: there is no screen "${step.screen}"`);
    if (step.action === "switch" && step.transition && !TRANSITIONS.includes(step.transition)) {
      throw new Error(`${where}: unknown transition "${step.transition}". Use one of: ${TRANSITIONS.join(", ")}`);
    }
    for (const [, name] of JSON.stringify(step).matchAll(VAR)) {
      if (name && !saved.has(name)) throw new Error(`${where} uses \${${name}} before a save step stores it`);
    }
    if (step.action === "save") saved.add(step.as);
  });
  if (pausedAt !== undefined) throw new Error(`Step ${pausedAt + 1} (pause-recording) needs a resume-recording after it`);
}

/** A stretch of steps between `pause-recording` and `resume-recording`. */
export interface Pause {
  /** Indexes of the pause-recording and resume-recording steps. */
  start: number;
  end: number;
  /** The screen on camera when recording pauses, and the one when it resumes. */
  from: string;
  to: string;
  /** Whether nothing was shown before the pause, so the video starts on `to`. */
  atStart: boolean;
  /** Set when the video changes screens on resume (never at the start): the last switch while paused, whose transition and caption are used then. */
  switchStep?: number;
}

/** Every paused stretch in a script that passed `checkScript`. */
export function pausesOf(script: Script): Pause[] {
  let screen = Object.keys(screensOf(script))[0]!;
  let shown = false;
  let open: Omit<Pause, "end" | "to"> | undefined;
  const pauses: Pause[] = [];
  script.steps.forEach((step, i) => {
    if (step.action === "switch") screen = step.screen;
    if (step.action === "pause-recording") {
      open = { start: i, from: screen, atStart: !shown };
    } else if (step.action === "resume-recording" && open) {
      const changesScreen = !open.atStart && screen !== open.from;
      pauses.push({ ...open, end: i, to: screen, switchStep: changesScreen ? open.switchStep : undefined });
      open = undefined;
    } else if (open) {
      if (step.action === "switch") open.switchStep = i;
    } else {
      shown = true;
    }
  });
  return pauses;
}

/** Steps that don't appear in the video, so their visual options are not used. */
export function hiddenSteps(script: Script): Set<number> {
  const hidden = new Set<number>();
  for (const pause of pausesOf(script)) {
    for (let i = pause.start; i <= pause.end; i++) if (i !== pause.switchStep) hidden.add(i);
  }
  return hidden;
}

/** A warning about visual options on steps that aren't recorded, or undefined when there are none. */
export function ignoredOptionsWarning(script: Script): string | undefined {
  const options = new Set<string>();
  const steps = [...hiddenSteps(script)].filter((i) => {
    const step: Record<string, unknown> = { ...script.steps[i] };
    const found = VISUAL_OPTIONS.filter((key) => step[key] !== undefined);
    for (const key of found) options.add(key);
    return found.length > 0;
  });
  if (!steps.length) return undefined;
  const one = steps.length === 1;
  const which = one ? `Step ${steps[0]! + 1} is` : `Steps ${steps.map((i) => i + 1).join(", ")} are`;
  return `${which} not recorded, so ${one ? "its" : "their"} ${[...options].join(", ").replace(/, (?=[^,]*$)/, " and ")} ${one && options.size === 1 ? "is" : "are"} ignored`;
}

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
    url: script.url && resolveUrl(script.url, dir),
    screens: script.screens && Object.fromEntries(Object.entries(script.screens).map(([name, s]) => [name, { ...s, url: resolveUrl(s.url, dir) }])),
    style: script.style && {
      ...script.style,
      background: script.style.background && fromDir(script.style.background),
    },
    // A URL with a saved value in it is resolved while recording, against the page it opens from.
    steps: script.steps.map((step) => (step.action === "goto" && !step.url.includes("${") ? { ...step, url: resolveUrl(step.url, dir) } : step)),
  };
  const outPath = fromDir(script.output?.path ?? `${basename(scriptPath, extname(scriptPath))}.mp4`);
  return { script: resolved, outPath };
}

export async function loadScript(path: string) {
  const scriptPath = resolve(path);
  const script: Script = await Bun.file(scriptPath).json();
  checkScript(script);
  return resolveScript(script, scriptPath);
}

/** Average adult silent reading speed in English (Brysbaert, 2019). */
const READING_WPM = 238;
/** Time for the eyes to find a caption that just appeared. */
export const NOTICE_MS = 400;

/** A saved value not filled in yet (a paused switch's caption may use one saved later) counts as this many words. */
const VALUE_WORDS = 3;

const wordCount = (text: string) => text.replace(VAR, Array(VALUE_WORDS).fill("x").join(" ")).split(/\s+/).filter(Boolean).length;

/** How long a viewer needs to read a caption. The recording waits this long before the captioned step acts. */
export function readingMs(caption: string) {
  return NOTICE_MS + Math.round((wordCount(caption) / READING_WPM) * 60_000);
}

/**
 * Identifies everything in the steps that changes what gets recorded. Zoom scale and the switch
 * transition only change the render, so they are left out. Of a caption only its length counts, since
 * the recording waits for it to be read; `zoom.include` is kept because it is measured while recording.
 * On `hidden` steps neither happens, so all their visual options are left out.
 */
export function stepsKey(steps: readonly Step[], hidden: ReadonlySet<number> = new Set()): string {
  return JSON.stringify(
    steps.map((step, i) => {
      const fields = Object.fromEntries(Object.entries(step).filter(([key]) => !(VISUAL_OPTIONS as readonly string[]).includes(key)));
      const caption = hidden.has(i) ? undefined : step.caption;
      const include = hidden.has(i) ? [] : (zoomOf(step)?.include ?? []);
      const recorded = {
        ...fields,
        ...(include.length ? { include } : {}),
        ...(typeof caption === "string" ? { captionWords: wordCount(caption) } : {}),
      };
      return Object.fromEntries(Object.entries(recorded).sort(([a], [b]) => a.localeCompare(b)));
    }),
  );
}

/** Identifies everything that changes what gets recorded: the screens and the steps. */
export function recordingKey(script: Script): string {
  return JSON.stringify([screensOf(script), JSON.parse(stepsKey(script.steps, hiddenSteps(script)))]);
}
