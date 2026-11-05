import { describe, expect, test } from "bun:test";
import { indexAt, itemAt } from "../src/timeline.ts";

const items = [{ t: 0 }, { t: 100 }, { t: 250 }];

describe("indexAt", () => {
  test("finds the last item at or before the time", () => {
    expect(indexAt(items, 0)).toBe(0);
    expect(indexAt(items, 99)).toBe(0);
    expect(indexAt(items, 100)).toBe(1);
    expect(indexAt(items, 1000)).toBe(2);
  });

  test("returns -1 before the first item or for an empty list", () => {
    expect(indexAt(items, -1)).toBe(-1);
    expect(indexAt([], 10)).toBe(-1);
  });
});

describe("itemAt", () => {
  test("falls back to the first item before the start", () => {
    expect(itemAt(items, -50)).toBe(items[0]);
    expect(itemAt(items, 260)).toBe(items[2]);
    expect(itemAt([], 0)).toBeUndefined();
  });
});
