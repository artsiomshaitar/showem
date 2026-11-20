import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, devices, type Browser, type Locator, type Page } from "playwright-core";
import { caretOf, MIRRORED_STYLES } from "./caret.ts";
import { ensureTool } from "./deps.ts";
import { TAP_LEAD_MS } from "./device.ts";
import { center, clamp, lerp, union } from "./geometry.ts";
import { menuLayout, rowBox } from "./menu.ts";
import { cursorPath, easeInOutCubic, TRANSITION_MS, travelMs } from "./motion.ts";
import { fillStep, hiddenSteps, isPhone, NOTICE_MS, pausesOf, readingMs, recordingKey, screensOf, styleOf, type Pause } from "./script.ts";
import type { Box, Frame, Point, Recording, Sample, Script, ScreenRecording, Size, Stall, Step, StepLog, Switch, VoiceClip } from "./types.ts";
import type { Around, Clip, Speak } from "./voice.ts";

const DEFAULT_SCALE_FACTOR = 3;
const JPEG_QUALITY = 98;
const LEAD_IN_MS = 600;
const LEAD_OUT_MS = 800;
const SETTLE_MS = 250;
const BEFORE_CLICK_MS = 60;
const CLICK_HOLD_MS = 60;
const BEFORE_TYPING_MS = 80;
const KEY_DELAY_MS = 60;
const MOUSE_STEP_MS = 8;
const SCROLL_PX_PER_TICK = 40;
const SCROLL_TICK_MS = 16;
/** A drag waits this long after pressing before it moves, and before letting go, so the page sees a grab and a drop. */
const DRAG_GRAB_MS = 150;
const DRAG_DROP_MS = 150;
const MIN_DRAG_MS = 500;
const MAX_DRAG_MS = 1400;
const DRAG_MS_PER_PX = 1.5;
/** Off camera a drag still moves in steps, for pages that only follow a pointer that keeps moving. */
const OFF_CAMERA_DRAG_MS = 100;
/** Quiet time around a switch: the result of the last step stays on screen before, and the next step waits after. */
const BEFORE_SWITCH_MS = 500;
const AFTER_SWITCH_MS = 600;
const SAVE_TIMEOUT_MS = 5000;
/** The longest wait for a smooth scroll to a target to finish. */
const SCROLL_TO_TIMEOUT_MS = 3000;
/** How long a zoom-in waits, so the camera is there before the next step starts. */
const ZOOM_IN_MS = 800;
/** How long a select's menu stays open before the pointer moves to the option, and after it clicks it. */
const MENU_OPEN_MS = 350;
const MENU_PICK_MS = 200;
/** How long the result of a captioned step stays on screen before the next step starts. */
const CAPTION_HOLD_MS = 600;
/** Quiet between one said caption and the next, like a narrator's breath between sentences. */
const VOICE_GAP_MS = 500;
/**
 * With a voice, an action starts this long before its caption has been said, so the pointer arrives as the sentence ends.
 * Viewers follow best when words and what they describe happen together (Mayer's temporal contiguity), and a silent
 * caption has to be read before the eyes are free, but a heard one doesn't.
 */
const ACTION_LEAD_MS = 800;

/** How long a caption takes: to read, or to say and breathe after. */
const captionMs = (caption: string | undefined, clip: Clip | undefined) => (!caption ? 0 : clip ? clip.ms + VOICE_GAP_MS : readingMs(caption));
/** A gap between two animation frames longer than this means the browser stopped drawing for a moment. */
const STALL_MS = 100;
/** The last frame drawn before such a gap can reach the screencast this long after the gap starts. */
const STALL_FRAME_MS = 50;
/** With no screencast frame during the gap, one this soon after it means the page changed meanwhile: the video jumps
 * there. A busy machine can take over 80 ms to send that frame. */
const STALL_NEXT_FRAME_MS = 120;

type SaveStep = Extract<Step, { action: "save" }>;
type DragStep = Extract<Step, { action: "drag" }>;
type SelectStep = Extract<Step, { action: "select" }>;
type NativeSelect = { options: string[]; selected: number; popup: boolean; fontSize: number };

/** The select's options if `loc` is a native `<select>`, or null for a dropdown made of page elements. */
function nativeSelect(loc: Locator): Promise<NativeSelect | null> {
  return loc.evaluate((el) =>
    el instanceof HTMLSelectElement
      ? { options: [...el.options].map((o) => o.label.trim()), selected: el.selectedIndex, popup: !el.multiple && el.size <= 1, fontSize: parseFloat(getComputedStyle(el).fontSize) }
      : null,
  );
}

function optionIndex(select: NativeSelect, step: SelectStep) {
  const i = select.options.indexOf(step.option);
  if (i === -1) throw new Error(`${step.target} has no option "${step.option}". Its options: ${select.options.map((o) => `"${o}"`).join(", ")}`);
  return i;
}

/** The `type` of a native date or time input, or null for any other element. */
function dateInputType(loc: Locator) {
  return loc.evaluate((el) => (el instanceof HTMLInputElement && ["date", "time", "datetime-local", "month", "week"].includes(el.type) ? el.type : null));
}

const TIME = /^(\d{1,2}):(\d{2})\s*([ap]m)?$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_EXAMPLES: Record<string, string> = { time: "14:00 or 2:00 PM", date: "2026-11-07", "datetime-local": "2026-11-07T14:00" };

function timeKeys(text: string) {
  const m = TIME.exec(text.trim());
  if (!m) return undefined;
  const pm = m[3] ? m[3].toLowerCase() === "pm" : Number(m[1]) >= 12;
  const hour = m[3] ? (Number(m[1]) % 12) + (pm ? 12 : 0) : Number(m[1]);
  return { value: `${String(hour).padStart(2, "0")}:${m[2]}`, keys: [`${String(hour % 12 || 12).padStart(2, "0")}${m[2]}${pm ? "P" : "A"}`] };
}

function dayKeys(text: string) {
  const m = DATE.exec(text.trim());
  return m ? { value: text.trim(), keys: [`${m[2]}${m[3]}${m[1]}`] } : undefined;
}

/**
 * Reads `text` for a native date or time input: its value as the input stores it (`14:00`, `2026-11-07`,
 * `2026-11-07T14:00`), or a time as `2:00 PM`. `keys` are what a person types into its parts, in the browser's
 * US order. Each full part moves on to the next by itself, except the year, which can take more digits.
 * Month and week inputs get no keys: their value is set directly.
 */
export function dateKeys(type: string, text: string): { value: string; keys: string[] } {
  if (type === "month" || type === "week") return { value: text.trim(), keys: [] };
  const [day, time] = text.split("T");
  let parsed: { value: string; keys: string[] } | undefined;
  if (type === "time") parsed = timeKeys(text);
  else if (type === "date") parsed = dayKeys(text);
  else if (time !== undefined) {
    const d = dayKeys(day!);
    const t = timeKeys(time);
    parsed = d && t && { value: `${d.value}T${t.value}`, keys: [...d.keys, "ArrowRight", ...t.keys] };
  }
  if (!parsed) throw new Error(`"${text}" isn't a ${type} value. Write it like ${DATE_EXAMPLES[type]}`);
  return parsed;
}

/**
 * If `loc` is out of view, scrolls it to the middle the way a person would: smoothly, not in one jump.
 * An element bigger than the window counts as in view once it fills the window on that side, since no scroll can show more of it.
 */
function scrollIntoViewSmoothly(loc: Locator) {
  return loc.evaluate(
    (el, timeout) =>
      new Promise<void>((resolve) => {
        const r = el.getBoundingClientRect();
        const shown = (start: number, end: number, size: number) => (end - start > size ? start <= 0 && end >= size : start >= 0 && end <= size);
        if (shown(r.top, r.bottom, innerHeight) && shown(r.left, r.right, innerWidth)) return resolve();
        document.addEventListener("scrollend", () => resolve(), { capture: true, once: true });
        setTimeout(resolve, timeout);
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      }),
    SCROLL_TO_TIMEOUT_MS,
  );
}

/** Everything visible that could be the option `step` picks: an option element, or any element with exactly its text. */
const optionMatches = (page: Page, step: SelectStep) =>
  page.getByRole("option", { name: step.option, exact: true }).or(page.getByText(step.option, { exact: true })).filter({ visible: true });

/**
 * Opens a dropdown made of page elements with `open` and returns the option it showed. The trigger may already show the
 * option's text, so this waits for a match the click added, and takes the last one: the dropdown comes after its trigger.
 */
async function openOption(page: Page, step: SelectStep, open: () => Promise<void>) {
  const matches = optionMatches(page, step);
  const before = await matches.count();
  await open();
  await matches.nth(before).waitFor({ state: "visible" }).catch(() => {
    throw new Error(`no option "${step.option}" showed up after clicking ${step.target}`);
  });
  return matches.last();
}

/** Runs in every page and reports each long gap between its animation frames, with the wall-clock time it ended. */
function watchForStalls(stallMs: number) {
  // Iframes are left out: a hidden one can be throttled while the page itself draws fine.
  if (window !== window.top) return;
  let last = performance.now();
  const tick = (now: number) => {
    if (now - last > stallMs) (window as unknown as { __showemStall(end: number, ms: number): void }).__showemStall(performance.timeOrigin + now, now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Recording time: time since the start, leaving out the stretches when recording was paused. */
class Clock {
  readonly t0 = Date.now();
  private readonly pauses: { start: number; end: number }[] = [];

  readonly now = () => this.at(Date.now());

  /** The recording time of a wall-clock time. Anything during a pause is at the moment the pause began. */
  private pauseAt(wall: number) {
    return this.pauses.find((p) => wall >= p.start && wall < p.end);
  }

  at(wall: number) {
    // Exactly the pause's own start, so frames during a pause and `now()` while paused agree to the last digit.
    wall = this.pauseAt(wall)?.start ?? wall;
    let t = wall - this.t0;
    for (const p of this.pauses) t -= Math.max(0, Math.min(wall, p.end) - p.start);
    return t;
  }

  isPaused(wall: number) {
    return this.pauseAt(wall) !== undefined;
  }

  get paused() {
    return this.pauses.at(-1)?.end === Infinity;
  }

  /** With `fromStart`, everything so far is left out too, for a pause before anything was shown. */
  pause(fromStart = false) {
    this.pauses.push({ start: fromStart ? (this.pauses.at(-1)?.end ?? this.t0) : Date.now(), end: Infinity });
  }

  resume() {
    this.pauses.at(-1)!.end = Date.now();
  }
}

/**
 * Drives one screen's page and logs everything the planner needs: pointer path, clicks, caret, step timing.
 * On a touch screen there is no pointer travel: each tap jumps straight to its spot.
 */
export class Director {
  readonly cursor: Sample[] = [];
  readonly clicks: number[] = [];
  readonly holds: { down: number; up: number }[] = [];
  private pos: Point;
  private readonly home: Point;

  constructor(
    readonly page: Page,
    private readonly now: () => number,
    private readonly maxTravelMs: number,
    private readonly viewport: Size,
    private readonly touch: boolean,
  ) {
    this.home = this.pos = { x: viewport.width / 2, y: viewport.height / 2 };
    this.cursor.push({ t: 0, ...this.pos });
  }

  /** Moves the pointer back to the middle while the screen is out of view, so it doesn't come back resting on the last thing clicked. */
  async park() {
    const t = this.now();
    this.cursor.push({ t, ...this.pos }, { t: t + 1, ...this.home });
    this.pos = this.home;
    await this.page.mouse.move(this.pos.x, this.pos.y);
  }

  /**
   * Puts the mouse where the drawn pointer is: in the middle at first, also on touch screens, where it is still
   * what scroll wheel events are aimed at. Again on resume, since paused steps move it without drawing it.
   */
  async start() {
    await this.page.mouse.move(this.pos.x, this.pos.y);
  }

  async run(step: Step, log: StepLog) {
    const { page } = this;
    switch (step.action) {
      case "click":
      case "hover":
      case "type": {
        log.point = await this.pointOf(step.target);
        await this.approach(log.point, log);
        if (step.action === "hover") break;
        await this.press(log.point);
        if (step.action === "type") await this.type(step.target, step.text, step.delayMs ?? KEY_DELAY_MS, log);
        break;
      }
      case "drag":
        await this.drag(step, log);
        break;
      case "select": {
        const loc = page.locator(step.target).first();
        log.point = await this.pointOf(step.target);
        const native = await nativeSelect(loc);
        await this.approach(log.point, log);
        if (native) await this.pickNative(loc, native, step, log);
        else await this.pickCustom(loc, step, log);
        break;
      }
      case "zoom-in": {
        const loc = page.locator(step.target).first();
        await loc.waitFor({ state: "visible" });
        await scrollIntoViewSmoothly(loc);
        const box = await loc.boundingBox();
        if (!box) throw new Error(`No bounding box for ${step.target}`);
        log.shotBox = box;
        log.point = center(box);
        log.actionAt = this.now();
        await Bun.sleep(ZOOM_IN_MS);
        break;
      }
      case "zoom-out":
        log.actionAt = this.now();
        break;
      case "scroll": {
        if ("target" in step) {
          const loc = page.locator(step.target).first();
          await loc.waitFor({ state: "visible" });
          await scrollIntoViewSmoothly(loc);
          // The smooth scroll only moves the window; this also scrolls a panel the element sits in.
          await loc.scrollIntoViewIfNeeded();
          break;
        }
        const ticks = Math.max(1, Math.round(Math.abs(step.y) / SCROLL_PX_PER_TICK));
        for (let i = 0; i < ticks; i++) {
          await page.mouse.wheel(0, step.y / ticks);
          await Bun.sleep(SCROLL_TICK_MS);
        }
        break;
      }
      default:
        await this.runAnyway(step);
    }
  }

  /** Runs a step while recording is paused: at full speed, with no pointer travel, clicks or caret to log. */
  async runOffCamera(step: Step) {
    const { page } = this;
    switch (step.action) {
      case "click":
      case "type": {
        const loc = page.locator(step.target).first();
        await (this.touch ? loc.tap() : loc.click());
        if (step.action !== "type") break;
        const dateType = await dateInputType(loc);
        if (dateType) await loc.fill(dateKeys(dateType, step.text).value);
        else await page.keyboard.type(step.text);
        break;
      }
      case "hover":
        await page.locator(step.target).first().hover();
        break;
      case "drag": {
        const from = center(await this.boxOf(step.target, false));
        await page.mouse.move(from.x, from.y);
        await this.dragAlong(from, await this.dropPoint(step, from), OFF_CAMERA_DRAG_MS);
        break;
      }
      case "select": {
        const loc = page.locator(step.target).first();
        await loc.waitFor({ state: "visible" });
        const native = await nativeSelect(loc);
        if (native) {
          await loc.selectOption({ index: optionIndex(native, step) });
        } else {
          const option = await openOption(page, step, () => (this.touch ? loc.tap() : loc.click()));
          await (this.touch ? option.tap() : option.click());
        }
        break;
      }
      case "scroll":
        if ("target" in step) await page.locator(step.target).first().scrollIntoViewIfNeeded();
        else await page.mouse.wheel(0, step.y);
        break;
      case "zoom-in":
        await page.locator(step.target).first().waitFor({ state: "visible" });
        break;
      default:
        await this.runAnyway(step);
    }
  }

  /** The steps that run the same whether recording or not. */
  private async runAnyway(step: Step) {
    const { page } = this;
    switch (step.action) {
      case "goto":
        await page.goto(new URL(step.url, page.url()).href, { waitUntil: "load" });
        break;
      case "press":
        await page.keyboard.press(step.key);
        break;
      case "wait-for":
        await page.locator(step.target).first().waitFor({ state: "visible" });
        break;
      case "wait":
        await Bun.sleep(step.ms);
        break;
    }
  }

  /** Reads the value a `save` step stores: an element's attribute or text, the page URL, or the clipboard. */
  async save(step: SaveStep): Promise<string> {
    if ("from" in step) {
      return step.from === "url" ? this.page.url() : await this.page.evaluate(() => navigator.clipboard.readText());
    }
    const loc = this.page.locator(step.target).first();
    await loc.waitFor({ state: "attached", timeout: SAVE_TIMEOUT_MS }).catch(() => {
      throw new Error(`save "${step.as}": nothing matches ${step.target}`);
    });
    const value = step.attribute
      ? await loc.evaluate((el, name) => {
          // Properties first, so `href` and `src` come back as absolute URLs and `value` as what is typed now.
          const prop: unknown = Reflect.get(el, name);
          return typeof prop === "string" ? prop : el.getAttribute(name);
        }, step.attribute)
      : (await loc.innerText()).trim();
    if (value === null || value === undefined) throw new Error(`save "${step.as}": ${step.target} has no attribute "${step.attribute}"`);
    return value;
  }

  /** The area the camera should frame: the target plus the elements listed in `keep-in-view`. */
  async shotBox(target: string, keepInView: readonly string[]): Promise<Box | undefined> {
    const boxes: Box[] = [];
    for (const selector of [target, ...keepInView]) {
      const box = await this.page.locator(selector).first().boundingBox({ timeout: 1000 }).catch(() => null);
      if (box) boxes.push(box);
      else console.error(`keep-in-view: nothing visible matches ${selector}`);
    }
    return union(boxes);
  }

  private async pointOf(target: string) {
    return center(await this.boxOf(target));
  }

  /** Brings the element into view, smoothly unless off camera, and returns its box. */
  private async boxOf(target: string, smooth = true) {
    const loc = this.page.locator(target).first();
    await loc.waitFor({ state: "visible" });
    if (smooth) await scrollIntoViewSmoothly(loc);
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    if (!box) throw new Error(`No bounding box for ${target}`);
    return box;
  }

  /** Where a drag lets go: over the center of `to`, or `by` pixels away from where it grabbed. */
  /** Where a drag lets go: over the center of `to`, or `by` pixels away from where it grabbed. It must be on screen to land. */
  private async dropPoint(step: DragStep, from: Point): Promise<Point> {
    let to: Point;
    if ("by" in step) {
      to = { x: from.x + (step.by.x ?? 0), y: from.y + (step.by.y ?? 0) };
    } else {
      const box = await this.page.locator(step.to).first().boundingBox();
      if (!box) throw new Error(`drag: nothing visible matches ${step.to}`);
      to = center(box);
    }
    const { width, height } = this.viewport;
    if (to.x < 0 || to.y < 0 || to.x > width || to.y > height) {
      throw new Error(`drag: the drop point (${Math.round(to.x)}, ${Math.round(to.y)}) is outside the ${width} x ${height} page, so nothing would be dropped`);
    }
    return to;
  }

  private async drag(step: DragStep, log: StepLog) {
    const grabbed = await this.boxOf(step.target);
    const from = center(grabbed);
    const to = await this.dropPoint(step, from);
    log.point = from;
    log.shotBox = union([grabbed, { ...to, width: 0, height: 0 }]);
    await this.moveTo(from);
    log.actionAt = this.now();
    await Bun.sleep(BEFORE_CLICK_MS);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const duration = step.durationMs ?? clamp(distance * DRAG_MS_PER_PX, MIN_DRAG_MS, MAX_DRAG_MS);
    const hold = { down: this.now(), up: Infinity };
    this.holds.push(hold);
    await this.dragAlong(from, to, duration, (p) => this.cursor.push({ t: this.now(), ...p }));
    hold.up = this.now();
    this.pos = to;
  }

  /**
   * Presses, moves to `to` with the button held, and lets go. The mouse moves every few milliseconds along a
   * straight eased path, so the page redraws what is dragged all the way.
   */
  private async dragAlong(from: Point, to: Point, duration: number, onMove?: (at: Point) => void) {
    await this.page.mouse.down();
    await Bun.sleep(DRAG_GRAB_MS);
    const start = Date.now();
    for (;;) {
      const k = duration > 0 ? Math.min(1, (Date.now() - start) / duration) : 1;
      const e = easeInOutCubic(k);
      const at = { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e) };
      await this.page.mouse.move(at.x, at.y);
      onMove?.(at);
      if (k >= 1) break;
      await Bun.sleep(MOUSE_STEP_MS);
    }
    await Bun.sleep(DRAG_DROP_MS);
    await this.page.mouse.up();
  }

  /** Brings the pointer to `at`. On a touch screen it waits for the tap instead. */
  private async approach(at: Point, log: StepLog) {
    if (!this.touch) await this.moveTo(at);
    log.actionAt = this.now();
  }

  /** Clicks or taps at `at`. Not `real`: only shows it, for a menu the page doesn't have. */
  private async press(at: Point, real = true) {
    if (this.touch) await this.tap(at, real);
    else await this.click(real);
  }

  /**
   * The browser opens a native select's menu outside the page, so it is never filmed and clicking it does nothing
   * the script can drive. The page isn't clicked: the menu is logged for the render to draw, and the value set directly.
   */
  private async pickNative(loc: Locator, select: NativeSelect, step: SelectStep, log: StepLog) {
    const chosen = optionIndex(select, step);
    await this.press(log.point!, false);
    await loc.focus();
    const box = await loc.boundingBox();
    if (select.popup && box) {
      const menu = menuLayout(box, select.options, select.selected, chosen, select.fontSize, this.viewport, this.touch);
      log.menu = { ...menu, openAt: this.now(), closeAt: 0 };
      log.shotBox = union([box, menu.box]);
      await Bun.sleep(MENU_OPEN_MS);
      const row = center(rowBox(menu, menu.to));
      if (!this.touch) await this.moveTo(row, false);
      await this.press(row, false);
      await Bun.sleep(MENU_PICK_MS);
    }
    await loc.selectOption({ index: chosen });
    if (log.menu) log.menu.closeAt = this.now();
  }

  private async pickCustom(loc: Locator, step: SelectStep, log: StepLog) {
    const option = await openOption(this.page, step, () => this.press(log.point!));
    await option.scrollIntoViewIfNeeded();
    const box = await option.boundingBox();
    if (!box) throw new Error(`no bounding box for option "${step.option}"`);
    log.shotBox = union([(await loc.boundingBox()) ?? box, box]);
    if (!this.touch) await this.moveTo(center(box));
    await this.press(center(box));
  }

  /** Not `real`: only the drawn pointer moves, along a path logged ahead of time, for a menu the page doesn't have. */
  private async moveTo(to: Point, real = true) {
    const from = this.pos;
    if (Math.hypot(to.x - from.x, to.y - from.y) < 1) return;
    const duration = travelMs(from, to, this.maxTravelMs);
    const path = cursorPath(from, to);
    if (!real) {
      const t0 = this.now();
      for (let ms = 0; ms < duration; ms += MOUSE_STEP_MS) this.cursor.push({ t: t0 + ms, ...path(ms / duration) });
      this.cursor.push({ t: t0 + duration, ...to });
      await Bun.sleep(duration);
      this.pos = to;
      return;
    }
    const start = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - start) / duration);
      const p = path(k);
      await this.page.mouse.move(p.x, p.y);
      this.cursor.push({ t: this.now(), ...p });
      if (k >= 1) break;
      await Bun.sleep(MOUSE_STEP_MS);
    }
    this.pos = to;
  }

  private async tap(at: Point, real: boolean) {
    this.pos = at;
    this.cursor.push({ t: this.now(), ...at });
    await Bun.sleep(TAP_LEAD_MS);
    this.clicks.push(this.now());
    if (real) await this.page.touchscreen.tap(at.x, at.y);
  }

  private async click(real: boolean) {
    await Bun.sleep(BEFORE_CLICK_MS);
    this.clicks.push(this.now());
    if (real) await this.page.mouse.down();
    await Bun.sleep(CLICK_HOLD_MS);
    if (real) await this.page.mouse.up();
  }

  private async type(target: string, text: string, delayMs: number, log: StepLog) {
    await Bun.sleep(BEFORE_TYPING_MS);
    const input = this.page.locator(target).first();
    const dateType = await dateInputType(input);
    if (dateType) return this.typeDate(input, dateType, text, delayMs);
    const caret = async () => ({ t: this.now(), ...(await input.evaluate(caretOf, MIRRORED_STYLES)) });
    log.inputBox = (await input.boundingBox()) ?? undefined;
    log.caret = [await caret()];
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      log.caret.push(await caret());
      await Bun.sleep(delayMs);
    }
  }

  /** Types into a native date or time input part by part, from its first part, the way a person would. */
  private async typeDate(input: Locator, type: string, text: string, delayMs: number) {
    const { value, keys } = dateKeys(type, text);
    // The click focused whichever part was under the pointer; focusing again starts from the first one.
    await input.evaluate((el: HTMLElement) => {
      el.blur();
      el.focus();
    });
    for (const key of keys) {
      if (key === "ArrowRight") await this.page.keyboard.press(key);
      else for (const ch of key) {
        await this.page.keyboard.type(ch);
        await Bun.sleep(delayMs);
      }
    }
    // A browser that orders the parts differently gets the value set directly.
    if ((await input.inputValue()) !== value) await input.fill(value);
  }
}

/**
 * Opens every screen on its first page, each in its own context, so each has its own cookies and login.
 * `onStall` gets every moment a page stopped drawing: when it ended (wall clock) and for how long.
 */
export function openScreens(browser: Browser, script: Script, scaleFactor: number, onStall?: (screen: string, end: number, ms: number) => void) {
  return Promise.all(
    Object.entries(screensOf(script)).map(async ([name, screen]) => {
      const phone = isPhone(screen.frame);
      const context = await browser.newContext({
        viewport: screen.viewport,
        deviceScaleFactor: scaleFactor,
        ...(phone && { isMobile: true, hasTouch: true, userAgent: devices["iPhone 15 Pro"]?.userAgent }),
      });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      if (onStall) {
        await context.exposeBinding("__showemStall", (_, end: number, ms: number) => onStall(name, end, ms));
        await context.addInitScript(watchForStalls, STALL_MS);
      }
      const page = await context.newPage();
      await page.goto(screen.url, { waitUntil: "load" });
      return { name, screen, context, page, phone };
    }),
  );
}

/** With `speak`, each shown caption is read aloud and its step waits until it has been said. */
export async function record(script: Script, dir: string, speak?: Speak): Promise<Recording> {
  const framesDir = join(dir, "frames");
  await rm(framesDir, { recursive: true, force: true });

  const hidden = hiddenSteps(script);
  const clips = new Map<number, Clip>();
  const shown = script.steps.flatMap((s, i) => (!hidden.has(i) && s.caption ? [i] : []));
  const knownCaption = (i: number | undefined) => {
    const caption = i === undefined ? undefined : script.steps[i]?.caption;
    return caption?.includes("${") ? undefined : caption;
  };
  const around = (i: number): Around => ({ previous: knownCaption(shown[shown.indexOf(i) - 1]), next: knownCaption(shown[shown.indexOf(i) + 1]) });
  // Before the browser starts, so a wrong key or voice stops the run early. One at a time: ElevenLabs plans limit how many run at once.
  if (speak) {
    for (const i of shown) {
      const caption = knownCaption(i);
      if (caption) await speak(caption, around(i));
    }
  }

  // The screencast only sends device pixels when the scale is forced for the whole browser, so all screens share it.
  const scaleFactor = script.deviceScaleFactor ?? DEFAULT_SCALE_FACTOR;
  // Without the GPU, headless Chromium redraws effects like a blurred backdrop on the CPU, and at 3x it films about 5 frames a second.
  const browser = await chromium.launch({ executablePath: await ensureTool("chromium"), headless: true, args: [`--force-device-scale-factor=${scaleFactor}`, "--enable-gpu"] });
  try {
    const pageStalls: { screen: string; end: number; ms: number }[] = [];
    const screens = await openScreens(browser, script, scaleFactor, (screen, end, ms) => pageStalls.push({ screen, end, ms }));
    for (const { name } of screens) await mkdir(join(framesDir, name), { recursive: true });

    const clock = new Clock();
    const { now } = clock;
    const writes: Promise<number>[] = [];
    const travel = styleOf(script).travelMs;
    const live = await Promise.all(
      screens.map(async ({ name, screen, context, page, phone }) => {
        const urls = [{ t: 0, url: page.url() }];
        page.on("framenavigated", (frame) => {
          if (frame === page.mainFrame()) urls.push({ t: now(), url: frame.url() });
        });
        // Every screen records for the whole run, on camera or not, so a fade always has its current frame.
        const frames: Frame[] = [];
        const cdp = await context.newCDPSession(page);
        cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
          cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
          const file = `${name}/${String(frames.length).padStart(6, "0")}.jpg`;
          // Wall-clock time for now: a pause can start before an earlier frame, so these become recording times at the end.
          frames.push({ file, t: metadata.timestamp ? metadata.timestamp * 1000 : Date.now() });
          writes.push(Bun.write(join(framesDir, file), Buffer.from(data, "base64")));
        });
        await cdp.send("Page.startScreencast", {
          format: "jpeg",
          quality: JPEG_QUALITY,
          maxWidth: screen.viewport.width * scaleFactor,
          maxHeight: screen.viewport.height * scaleFactor,
        });
        const director = new Director(page, now, travel, screen.viewport, phone);
        await director.start();
        return { name, screen, urls, frames, cdp, director };
      }),
    );
    const directors = new Map(live.map((s) => [s.name, s.director]));

    let firstScreen = live[0]!.name;
    let active = firstScreen;
    const vars: Record<string, string> = {};
    const switches: Switch[] = [];
    const pauses = pausesOf(script);
    // Set while paused when resuming changes screens. `captionAt` and `reading` are for the paused switch's caption.
    let resumeSwitch: (Pick<Switch, "step" | "leave" | "from"> & { captionAt: number; reading: number }) | undefined;
    let pause: Pause | undefined;
    // The video starts with the first step that isn't paused.
    const leadInAt = script.steps.findIndex((_, i) => !pauses.some((p) => p.start <= i && i <= p.end));
    const steps: StepLog[] = [];
    for (const [index, original] of script.steps.entries()) {
      const step = fillStep(original, vars);
      // A caption with a saved value is only read aloud now; the clock stops meanwhile, so the wait isn't in the video.
      // A switch while paused was already timed by its reading time, so it stays silent.
      if (speak && step.caption && !hidden.has(index) && !clips.has(index) && !clock.paused) {
        const known = knownCaption(index) !== undefined;
        if (!known) clock.pause();
        clips.set(index, await speak(step.caption, around(index)));
        if (!known) clock.resume();
      }
      if (index === leadInAt) {
        await Bun.sleep(LEAD_IN_MS);
        firstScreen = active;
      }
      const log: StepLog = { index, screen: active, start: now(), end: 0 };
      const director = directors.get(active)!;
      if (step.action === "pause-recording") {
        pause = pauses.find((p) => p.start === index)!;
        const step = pause.switchStep;
        if (step !== undefined) {
          const caption = script.steps[step]?.caption;
          const known = knownCaption(step);
          const clip = speak && known ? await speak(known, around(step)) : undefined;
          if (clip) clips.set(step, clip);
          const reading = captionMs(caption, clip);
          await Bun.sleep(BEFORE_SWITCH_MS);
          const captionAt = now();
          if (reading) await Bun.sleep(NOTICE_MS);
          resumeSwitch = { step, leave: log.start, from: active, captionAt, reading };
        }
        clock.pause(pause.atStart);
      } else if (step.action === "resume-recording") {
        await director.page.waitForLoadState("load");
        await Bun.sleep(SETTLE_MS);
        for (const d of directors.values()) await d.start();
        // Taken while still paused: the moment every frame captured during the pause is stamped with.
        const start = now();
        clock.resume();
        if (resumeSwitch) {
          const { captionAt, reading, ...change } = resumeSwitch;
          await Bun.sleep(TRANSITION_MS);
          switches.push({ ...change, start, end: now(), to: active, freezeOutgoing: true });
          resumeSwitch = undefined;
          await Bun.sleep(Math.max(AFTER_SWITCH_MS, reading - (now() - captionAt)));
          // Like a visible switch step, the paused one lasts until the screen it moved to has settled.
          steps.find((l) => l.index === change.step)!.end = now();
        }
      } else if (clock.paused) {
        if (step.action === "switch") {
          // Not the screen the video resumes on, which should come back with its pointer where it was.
          if (active !== pause?.to) await director.park();
          active = log.screen = step.screen;
          // Its caption shows before the transition, like a visible switch's.
          if (index === resumeSwitch?.step) log.start = resumeSwitch.captionAt;
        } else if (step.action === "save") {
          vars[step.as] = await director.save(step);
        } else {
          await director.runOffCamera(step);
        }
      } else {
        // A caption shows first and the step waits until it has been read, so the viewer can watch what happens next.
        // A said caption only gets a head start: the action lands as the sentence ends.
        // On a switch the caption only needs to be noticed before the slide; the rest is read during and after it.
        const clip = clips.get(index);
        const reading = captionMs(step.caption, clip);
        const acts = step.action !== "wait" && step.action !== "wait-for" && step.action !== "save";
        if (step.action !== "switch") await Bun.sleep(step.action === "wait" ? Math.max(0, reading - step.ms) : clip && acts ? Math.max(NOTICE_MS, clip.ms - ACTION_LEAD_MS) : reading);
        if (step.action === "switch") {
          if (step.screen !== active) {
            const leave = log.start;
            await Bun.sleep(BEFORE_SWITCH_MS);
            log.start = now();
            if (reading) await Bun.sleep(NOTICE_MS);
            const start = now();
            await Bun.sleep(TRANSITION_MS);
            switches.push({ step: index, leave, start, end: now(), from: active, to: step.screen });
            await director.park();
            active = log.screen = step.screen;
            await Bun.sleep(Math.max(AFTER_SWITCH_MS, reading - (now() - log.start)));
          } else {
            await Bun.sleep(reading);
          }
        } else if (step.action === "save") {
          vars[step.as] = await director.save(step);
        } else {
          await director.run(step, log);
          // The next caption waits until this one has been said.
          const saying = clip ? log.start + reading - now() : 0;
          if (step.action !== "wait" && step.action !== "wait-for") await Bun.sleep(Math.max(step.caption ? CAPTION_HOLD_MS : SETTLE_MS, saying));
          else if (saying > 0) await Bun.sleep(saying);
          if ("keepInView" in step && step.keepInView?.length) {
            const kept = await director.shotBox(step.target, step.keepInView);
            log.shotBox = union([log.shotBox, kept].filter((box) => box !== undefined));
          }
        }
      }
      log.end = now();
      steps.push(log);
    }
    if (leadInAt === -1) firstScreen = active;
    await Bun.sleep(LEAD_OUT_MS);
    const duration = now();
    await Promise.all(live.map((s) => s.cdp.send("Page.stopScreencast")));
    await Promise.all(writes);
    const stalls: Stall[] = [];
    for (const { screen, end, ms } of pageStalls) {
      const start = end - ms;
      if (clock.isPaused(start) || clock.isPaused(end)) continue;
      const frames = live.find((s) => s.name === screen)!.frames;
      // Only a gap the video shows: no frame while the page wasn't drawing (the one it drew last can land just after
      // the gap starts), then one as soon as it drew again.
      const filmed = frames.some((f) => f.t > start + STALL_FRAME_MS && f.t < end);
      if (filmed || !frames.some((f) => f.t >= end && f.t <= end + STALL_NEXT_FRAME_MS)) continue;
      const t = clock.at(start);
      const step = steps.find((l) => l.screen === screen && t >= l.start && t <= l.end);
      if (step) stalls.push({ screen, step: step.index, t, ms: Math.round(ms) });
    }
    for (const s of live) for (const f of s.frames) f.t = Math.max(0, clock.at(f.t));
    // Said from when its caption shows.
    const voice: VoiceClip[] = [...clips].map(([step, clip]) => ({ step, file: clip.file, start: steps.find((l) => l.index === step)!.start }));

    const recording: Recording = {
      key: recordingKey(script),
      duration,
      firstScreen,
      screens: Object.fromEntries(
        live.map((s): [string, ScreenRecording] => [
          s.name,
          { frame: s.screen.frame, viewport: s.screen.viewport, frames: s.frames, cursor: s.director.cursor, clicks: s.director.clicks, holds: s.director.holds, urls: s.urls },
        ]),
      ),
      switches,
      steps,
      vars,
      ...(stalls.length && { stalls }),
      ...(voice.length && { voice }),
    };
    await Bun.write(join(dir, "recording.json"), JSON.stringify(recording, null, 2));
    return recording;
  } finally {
    await browser.close();
  }
}
