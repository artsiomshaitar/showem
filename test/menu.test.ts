import { expect, test } from "bun:test";
import { menuLayout, rowAt, rowBox } from "../src/menu.ts";

const viewport = { width: 800, height: 600 };
const select = { x: 100, y: 100, width: 200, height: 40 };
const options = ["A", "B", "C"];

test("opens below the select, with the selected and chosen rows", () => {
  const menu = menuLayout(select, options, 0, 2, 16, viewport);
  expect(menu.box.y).toBeGreaterThan(select.y + select.height);
  expect(menu.box.width).toBe(select.width);
  expect([menu.from, menu.to]).toEqual([0, 2]);
});

test("opens above when there is no room below", () => {
  const menu = menuLayout({ ...select, y: 540 }, options, 0, 1, 16, viewport);
  expect(menu.box.y + menu.box.height).toBeLessThan(540);
});

test("a long list shows the rows around the chosen option", () => {
  const many = Array.from({ length: 30 }, (_, i) => `Option ${i}`);
  const menu = menuLayout(select, many, 0, 20, 16, { width: 800, height: 2000 });
  expect(menu.options).toHaveLength(10);
  expect(menu.options[menu.to]).toBe("Option 20");
  expect(menu.from).toBe(-1);
});

test("finds the row under a point", () => {
  const menu = menuLayout(select, options, 0, 1, 16, viewport);
  const row = rowBox(menu, 1);
  expect(rowAt(menu, { x: row.x + 5, y: row.y + row.height / 2 })).toBe(1);
  expect(rowAt(menu, { x: 10, y: row.y })).toBe(-1);
});

test("on an iPhone it is Safari's menu: narrower, taller rows, kept inside the screen", () => {
  const phone = { width: 393, height: 798 };
  const menu = menuLayout({ x: 300, y: 100, width: 80, height: 40 }, options, 0, 1, 14, phone, true);
  expect(menu.ios).toBe(true);
  expect([menu.box.width, menu.rowHeight, menu.fontSize]).toEqual([250, 44, 17]);
  expect(menu.box.x + menu.box.width).toBeLessThanOrEqual(phone.width - 8);
});
