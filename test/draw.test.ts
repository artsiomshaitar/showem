import { expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { drawMenu, pressScale, urlLabel } from "../src/draw.ts";
import { menuLayout, rowBox } from "../src/menu.ts";

test("the address bar shows host and path, or the file name", () => {
  expect(urlLabel("https://example.com/pricing/")).toBe("example.com/pricing");
  expect(urlLabel("http://localhost:3000/")).toBe("localhost:3000");
  expect(urlLabel("file:///Users/me/My%20App/index.html")).toBe("index.html");
  expect(urlLabel("not a url")).toBe("not a url");
});

test("the cursor shrinks on press and settles back to normal size", () => {
  expect(pressScale(0)).toBe(1);
  expect(pressScale(0.19)).toBeLessThan(0.85);
  expect(pressScale(0.7)).toBeGreaterThan(1);
  expect(pressScale(1)).toBeCloseTo(1);
});

test("an iPhone select menu highlights the tapped row in gray, and a desktop one in blue", () => {
  const pixelAt = (ios: boolean) => {
    const canvas = createCanvas(400, 400);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 400, 400);
    const menu = { ...menuLayout({ x: 20, y: 20, width: 200, height: 30 }, ["A", "B"], 0, 1, 14, { width: 400, height: 400 }, ios), openAt: 0, closeAt: 10_000 };
    const row = rowBox(menu, 1);
    drawMenu(ctx, menu, 1000, { x: row.x + row.width - 10, y: row.y + row.height / 2 });
    return [...ctx.getImageData(row.x + row.width - 10, row.y + row.height / 2, 1, 1).data];
  };
  const [r, g, b] = pixelAt(true);
  expect(Math.abs(r! - b!)).toBeLessThan(10);
  expect(r).toBeLessThan(240);
  const [dr, , db] = pixelAt(false);
  expect(db).toBeGreaterThan(dr! + 100);
});
