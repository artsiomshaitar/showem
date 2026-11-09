import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { ensureTool } from "./deps.ts";
import { Director, openScreens } from "./record.ts";
import { fillStep } from "./script.ts";
import type { Script } from "./types.ts";

/** How long a step waits for its element. Shorter than a recording's, so a wrong selector fails fast. */
export const TRY_TIMEOUT_MS = 10_000;

export interface TryResult {
  /** The step that failed, if one did. `afterWait`: a skipped `wait` came right before it. */
  failed?: { step: number; message: string; afterWait: boolean };
  /** A screenshot of each screen where the run ended. */
  shots: Record<string, string>;
}

/**
 * Runs the steps in a headless browser at full speed, without recording, and stops at the first step that fails.
 * `wait` steps are skipped: they give viewers time to look, and there are no viewers here.
 */
export async function tryScript(script: Script, dir: string): Promise<TryResult> {
  const browser = await chromium.launch({ executablePath: await ensureTool("chromium"), headless: true });
  try {
    const screens = await openScreens(browser, script, 1);
    const directors = new Map(
      screens.map(({ name, screen, context, page, phone }) => {
        context.setDefaultTimeout(TRY_TIMEOUT_MS);
        return [name, new Director(page, () => 0, 0, screen.viewport, phone)];
      }),
    );
    // Wheel scrolls go where the mouse is, so it starts where a recording starts it.
    for (const director of directors.values()) await director.start();
    let active = screens[0]!.name;
    const vars: Record<string, string> = {};
    let failed: TryResult["failed"];
    let afterWait = false;
    for (const [index, original] of script.steps.entries()) {
      if (original.action === "wait") {
        afterWait = true;
        continue;
      }
      try {
        const step = fillStep(original, vars);
        const director = directors.get(active)!;
        if (step.action === "switch") active = step.screen;
        else if (step.action === "save") vars[step.as] = await director.save(step);
        else await director.runOffCamera(step);
      } catch (error) {
        failed = { step: index, message: (error as Error).message.split("\n")[0]!, afterWait };
        break;
      }
      if (!["pause-recording", "resume-recording", "save"].includes(original.action)) afterWait = false;
    }
    await mkdir(dir, { recursive: true });
    const shots: Record<string, string> = {};
    for (const { name, page } of screens) {
      shots[name] = join(dir, `try-${name}.png`);
      await page.screenshot({ path: shots[name] });
    }
    return { failed, shots };
  } finally {
    await browser.close();
  }
}
