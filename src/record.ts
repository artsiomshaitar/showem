import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { caretOf, MIRRORED_STYLES } from "./caret.ts";
import { center, union } from "./geometry.ts";
import { cursorPath, travelMs } from "./motion.ts";
import { DEFAULT_VIEWPORT, stepsKey, styleOf, zoomOf } from "./script.ts";
import type { Box, Frame, Point, Recording, Sample, Script, Step, StepLog } from "./types.ts";

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

/** Drives the page and logs everything the planner needs: cursor path, clicks, caret, step timing. */
class Director {
  readonly cursor: Sample[] = [];
  readonly clicks: number[] = [];
  private pos: Point;

  constructor(
    private readonly page: Page,
    private readonly now: () => number,
    private readonly maxTravelMs: number,
    viewport: { width: number; height: number },
  ) {
    this.pos = { x: viewport.width / 2, y: viewport.height / 2 };
    this.cursor.push({ t: 0, ...this.pos });
  }

  async start() {
    await this.page.mouse.move(this.pos.x, this.pos.y);
  }

  async run(step: Step, log: StepLog) {
    const { page } = this;
    switch (step.action) {
      case "goto":
        await page.goto(step.url, { waitUntil: "load" });
        break;
      case "click":
      case "hover":
      case "type": {
        log.point = await this.pointOf(step.target);
        await this.moveTo(log.point);
        log.actionAt = this.now();
        if (step.action === "hover") break;
        await this.click();
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
  const viewport = script.viewport ?? DEFAULT_VIEWPORT;
  const scaleFactor = script.deviceScaleFactor ?? DEFAULT_SCALE_FACTOR;
  const framesDir = join(dir, "frames");
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: [`--force-device-scale-factor=${scaleFactor}`] });
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: scaleFactor });
    const page = await context.newPage();
    await page.goto(script.url, { waitUntil: "load" });

    const t0 = Date.now();
    const now = () => Date.now() - t0;
    const urls = [{ t: 0, url: page.url() }];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) urls.push({ t: now(), url: frame.url() });
    });

    const frames: Frame[] = [];
    const writes: Promise<number>[] = [];
    const cdp = await context.newCDPSession(page);
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      const file = `${String(frames.length).padStart(6, "0")}.jpg`;
      frames.push({ file, t: Math.max(0, metadata.timestamp ? metadata.timestamp * 1000 - t0 : now()) });
      writes.push(Bun.write(join(framesDir, file), Buffer.from(data, "base64")));
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: JPEG_QUALITY,
      maxWidth: viewport.width * scaleFactor,
      maxHeight: viewport.height * scaleFactor,
    });

    const director = new Director(page, now, styleOf(script).travelMs, viewport);
    await director.start();
    await Bun.sleep(LEAD_IN_MS);
    const steps: StepLog[] = [];
    for (const [index, step] of script.steps.entries()) {
      const log: StepLog = { index, start: now(), end: 0 };
      await director.run(step, log);
      if (step.action !== "pause" && step.action !== "waitFor") await Bun.sleep(SETTLE_MS);
      const include = zoomOf(step)?.include ?? [];
      if (include.length && "target" in step) log.shotBox = await director.shotBox(step.target, include);
      log.end = now();
      steps.push(log);
    }
    await Bun.sleep(LEAD_OUT_MS);
    const duration = now();
    await cdp.send("Page.stopScreencast");
    await Promise.all(writes);

    const recording: Recording = {
      stepsKey: stepsKey(script.steps),
      viewport,
      duration,
      frames,
      cursor: director.cursor,
      clicks: director.clicks,
      steps,
      urls,
    };
    await Bun.write(join(dir, "recording.json"), JSON.stringify(recording, null, 2));
    return recording;
  } finally {
    await browser.close();
  }
}
