import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, devices, type Page } from "playwright-core";
import { caretOf, MIRRORED_STYLES } from "./caret.ts";
import { TAP_LEAD_MS } from "./device.ts";
import { center, union } from "./geometry.ts";
import { cursorPath, TRANSITION_MS, travelMs } from "./motion.ts";
import { fillStep, isPhone, NOTICE_MS, pausesOf, readingMs, recordingKey, screensOf, styleOf, type Pause } from "./script.ts";
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

/** Recording time: time since the start, leaving out the stretches when recording was paused. */
class Clock {
  readonly t0 = Date.now();
  private readonly pauses: { start: number; end: number }[] = [];

  readonly now = () => this.at(Date.now());

  /** The recording time of a wall-clock time. Anything during a pause is at the moment the pause began. */
  at(wall: number) {
    // Exactly the pause's own start, so frames during a pause and `now()` while paused agree to the last digit.
    wall = this.pauses.find((p) => wall >= p.start && wall < p.end)?.start ?? wall;
    let t = wall - this.t0;
    for (const p of this.pauses) t -= Math.max(0, Math.min(wall, p.end) - p.start);
    return t;
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
      case "scroll": {
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
        if (step.action === "type") await page.keyboard.type(step.text);
        break;
      }
      case "hover":
        await page.locator(step.target).first().hover();
        break;
      case "scroll":
        await page.mouse.wheel(0, step.y);
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
          const reading = caption ? readingMs(caption) : 0;
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
        // On a switch the caption only needs to be noticed before the slide; the rest is read during and after it.
        const reading = step.caption ? readingMs(step.caption) : 0;
        if (step.action !== "switch") await Bun.sleep(step.action === "wait" ? Math.max(0, reading - step.ms) : reading);
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
          if (step.action !== "wait" && step.action !== "wait-for") await Bun.sleep(step.caption ? CAPTION_HOLD_MS : SETTLE_MS);
          if ("keepInView" in step && step.keepInView?.length) log.shotBox = await director.shotBox(step.target, step.keepInView);
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
    for (const s of live) for (const f of s.frames) f.t = Math.max(0, clock.at(f.t));

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
