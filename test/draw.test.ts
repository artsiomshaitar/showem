import { expect, test } from "bun:test";
import { pressScale, urlLabel } from "../src/draw.ts";

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
