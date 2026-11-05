export interface Timed {
  t: number;
}

/** Index of the last item with `t <= time`, or -1 if there is none. Items must be sorted by `t`. */
export function indexAt(items: readonly Timed[], time: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((items[mid]?.t ?? Infinity) <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** The last item with `t <= time`, or the first item when `time` is before all of them. */
export function itemAt<T extends Timed>(items: readonly T[], time: number): T | undefined {
  return items[Math.max(0, indexAt(items, time))];
}
