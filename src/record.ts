import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, devices, type Page } from "playwright-core";
import { caretOf, MIRRORED_STYLES } from "./caret.ts";
import { TAP_LEAD_MS } from "./device.ts";
import { center, union } from "./geometry.ts";
import { cursorPath, TRANSITION_MS, travelMs } from "./motion.ts";
import { fillStep, isPhone, NOTICE_MS, readingMs, recordingKey, screensOf, styleOf, zoomOf } from "./script.ts";
import type { Box, Frame, Point, Recording, Sample, Script, ScreenRecording, Step, StepLog, Switch } from "./types.ts";

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
/** Quiet time around a switch: the result of the last step stays on screen before, and the next step waits after. */
const BEFORE_SWITCH_MS = 500;
const AFTER_SWITCH_MS = 600;
const SAVE_TIMEOUT_MS = 5000;
/** How long the result of a captioned step stays on screen before the next step starts. */
const CAPTION_HOLD_MS = 600;

type SaveStep = Extract<Step, { action: "save" }>;

/**
 * Drives one screen's page and logs everything the planner needs: pointer path, clicks, caret, step timing.
 * On a touch screen there is no pointer travel: each tap jumps straight to its spot.
 */
class Director {
  readonly cursor: Sample[] = [];
  readonly clicks: number[] = [];
  private pos: Point;
  private readonly home: Point;

  constructor(
    readonly page: Page,
    private readonly now: () => number,
    private readonly maxTravelMs: number,
    viewport: { width: number; height: number },
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

  /** Puts the mouse in the middle, also on touch screens, where it is still what scroll wheel events are aimed at. */
  async start() {
    await this.page.mouse.move(this.pos.x, this.pos.y);
  }

  async run(step: Step, log: StepLog) {
    const { page } = this;
    switch (step.action) {
      case "goto":
        await page.goto(new URL(step.url, page.url()).href, { waitUntil: "load" });
        break;
      case "click":
      case "hover":
      case "type": {
        log.point = await this.pointOf(step.target);
        if (this.touch) {
          log.actionAt = this.now();
          if (step.action === "hover") break;
          await this.tap(log.point);
        } else {
          await this.moveTo(log.point);
          log.actionAt = this.now();
          if (step.action === "hover") break;
          await this.click();
        }
        if (step.action === "type") await this.type(step.target, step.text, step.delayMs ?? KEY_DELAY_MS, log);
        break;
      }
      case "press":
        await page.keyboard.press(step.key);
        break;
      case "scroll": {
        const ticks = Math.max(1, Math.round(Math.abs(step.y) / SCROLL_PX_PER_TICK));
        for (let i = 0; i < ticks; i++) {
          await page.mouse.wheel(0, step.y / ticks);
          await Bun.sleep(SCROLL_TICK_MS);
        }
        break;
      }
      case "waitFor":
        await page.locator(step.target).first().waitFor({ state: "visible" });
        break;
      case "pause":
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

  /** The area the camera should frame: the target plus the elements listed in `zoom.include`. */
  async shotBox(target: string, include: readonly string[]): Promise<Box | undefined> {
    const boxes: Box[] = [];
    for (const selector of [target, ...include]) {
      const box = await this.page.locator(selector).first().boundingBox({ timeout: 1000 }).catch(() => null);
      if (box) boxes.push(box);
      else console.error(`zoom.include: nothing visible matches ${selector}`);
    }
    return union(boxes);
  }

  private async pointOf(target: string) {
    const loc = this.page.locator(target).first();
    await loc.waitFor({ state: "visible" });
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    if (!box) throw new Error(`No bounding box for ${target}`);
    return center(box);
  }

  private async moveTo(to: Point) {
    const from = this.pos;
    if (Math.hypot(to.x - from.x, to.y - from.y) < 1) return;
    const duration = travelMs(from, to, this.maxTravelMs);
    const path = cursorPath(from, to);
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

  private async tap(at: Point) {
    this.pos = at;
    this.cursor.push({ t: this.now(), ...at });
    await Bun.sleep(TAP_LEAD_MS);
    this.clicks.push(this.now());
    await this.page.touchscreen.tap(at.x, at.y);
  }

  private async click() {
    await Bun.sleep(BEFORE_CLICK_MS);
    this.clicks.push(this.now());
    await this.page.mouse.down();
    await Bun.sleep(CLICK_HOLD_MS);
    await this.page.mouse.up();
  }

  private async type(target: string, text: string, delayMs: number, log: StepLog) {
    await Bun.sleep(BEFORE_TYPING_MS);
    const input = this.page.locator(target).first();
    const caret = async () => ({ t: this.now(), ...(await input.evaluate(caretOf, MIRRORED_STYLES)) });
    log.inputBox = (await input.boundingBox()) ?? undefined;
    log.caret = [await caret()];
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      log.caret.push(await caret());
      await Bun.sleep(delayMs);
    }
  }
}

export async function record(script: Script, dir: string): Promise<Recording> {
  const framesDir = join(dir, "frames");
  await rm(framesDir, { recursive: true, force: true });

  // The screencast only sends device pixels when the scale is forced for the whole browser, so all screens share it.
  const scaleFactor = script.deviceScaleFactor ?? DEFAULT_SCALE_FACTOR;
  const browser = await chromium.launch({ headless: true, args: [`--force-device-scale-factor=${scaleFactor}`] });
  try {
    // One isolated context per screen, so each screen has its own cookies and login.
    const screens = await Promise.all(
      Object.entries(screensOf(script)).map(async ([name, screen]) => {
        const phone = isPhone(screen.frame);
        const context = await browser.newContext({
          viewport: screen.viewport,
          deviceScaleFactor: scaleFactor,
          ...(phone && { isMobile: true, hasTouch: true, userAgent: devices["iPhone 15 Pro"]?.userAgent }),
        });
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        const page = await context.newPage();
        await page.goto(screen.url, { waitUntil: "load" });
        await mkdir(join(framesDir, name), { recursive: true });
        return { name, screen, context, page, phone };
      }),
    );

    const t0 = Date.now();
    const now = () => Date.now() - t0;
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
          frames.push({ file, t: Math.max(0, metadata.timestamp ? metadata.timestamp * 1000 - t0 : now()) });
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

    await Bun.sleep(LEAD_IN_MS);
    const firstScreen = live[0]!.name;
    let active = firstScreen;
    const vars: Record<string, string> = {};
    const switches: Switch[] = [];
    const steps: StepLog[] = [];
    for (const [index, original] of script.steps.entries()) {
      const step = fillStep(original, vars);
      const log: StepLog = { index, screen: active, start: now(), end: 0 };
      const director = directors.get(active)!;
      // A caption shows first and the step waits until it has been read, so the viewer can watch what happens next.
      // On a switch the caption only needs to be noticed before the slide; the rest is read during and after it.
      const reading = step.caption ? readingMs(step.caption) : 0;
      if (step.action !== "switch") await Bun.sleep(step.action === "pause" ? Math.max(0, reading - step.ms) : reading);
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
        if (step.action !== "pause" && step.action !== "waitFor") await Bun.sleep(step.caption ? CAPTION_HOLD_MS : SETTLE_MS);
        const include = zoomOf(step)?.include ?? [];
        if (include.length && "target" in step) log.shotBox = await director.shotBox(step.target, include);
      }
      log.end = now();
      steps.push(log);
    }
    await Bun.sleep(LEAD_OUT_MS);
    const duration = now();
    await Promise.all(live.map((s) => s.cdp.send("Page.stopScreencast")));
    await Promise.all(writes);

    const recording: Recording = {
      key: recordingKey(script),
      duration,
      firstScreen,
      screens: Object.fromEntries(
        live.map((s): [string, ScreenRecording] => [
          s.name,
          { frame: s.screen.frame, viewport: s.screen.viewport, frames: s.frames, cursor: s.director.cursor, clicks: s.director.clicks, urls: s.urls },
        ]),
      ),
      switches,
      steps,
      vars,
    };
    await Bun.write(join(dir, "recording.json"), JSON.stringify(recording, null, 2));
    return recording;
  } finally {
    await browser.close();
  }
}
