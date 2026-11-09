import { expect, test } from "bun:test";
import { CHROMIUM_VERSION } from "../src/deps.ts";

test("the downloaded Chromium matches the one playwright-core expects", async () => {
  const { browsers } = await Bun.file("node_modules/playwright-core/browsers.json").json();
  const shell = browsers.find((b: { name: string }) => b.name === "chromium-headless-shell");
  expect(CHROMIUM_VERSION).toBe(shell.browserVersion);
});
