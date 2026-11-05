import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright-core";
import { caretOf, MIRRORED_STYLES } from "../src/caret.ts";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent(`
    <style>input, textarea, span { font: 16px Arial; } input, textarea { padding: 6px 10px; border: 1px solid; width: 400px; }</style>
    <input id="left">
    <input id="centered" style="text-align: center">
    <input id="password" type="password">
    <textarea id="area" rows="4"></textarea>
    <span id="probe" style="white-space: pre"></span>
  `);
});

afterAll(() => browser.close());

async function typeAndMeasure(id: string, text: string) {
  const input = page.locator(`#${id}`);
  await input.pressSequentially(text);
  return {
    caret: await input.evaluate(caretOf, MIRRORED_STYLES),
    box: (await input.boundingBox())!,
  };
}

const textWidth = (text: string) =>
  page.locator("#probe").evaluate((el, value) => {
    el.textContent = value;
    return el.getBoundingClientRect().width;
  }, text);

const INSET = 11;

test("left-aligned input: the caret is right after the text", async () => {
  const { caret, box } = await typeAndMeasure("left", "hello world");
  expect(caret.x).toBeCloseTo(box.x + INSET + (await textWidth("hello world")), 0);
  expect(caret.y).toBeCloseTo(box.y + box.height / 2, 0);
});

test("centered input: the caret follows centered text", async () => {
  const { caret, box } = await typeAndMeasure("centered", "abc");
  expect(caret.x).toBeCloseTo(box.x + box.width / 2 + (await textWidth("abc")) / 2, 0);
});

test("password input: the caret follows the dots, not the hidden letters", async () => {
  const { caret, box } = await typeAndMeasure("password", "correct-horse");
  const dotsEnd = box.x + INSET + (await textWidth("•".repeat(13)));
  const lettersEnd = box.x + INSET + (await textWidth("correct-horse"));
  expect(Math.abs(caret.x - dotsEnd)).toBeLessThan(2);
  expect(Math.abs(caret.x - lettersEnd)).toBeGreaterThan(5);
});

test("textarea: the caret moves down to the next line", async () => {
  const area = page.locator("#area");
  await area.pressSequentially("first");
  const one = await area.evaluate(caretOf, MIRRORED_STYLES);
  await area.press("Enter");
  await area.pressSequentially("second");
  const two = await area.evaluate(caretOf, MIRRORED_STYLES);
  expect(two.y).toBeGreaterThan(one.y + 10);
});
