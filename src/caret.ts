import type { Point } from "./types.ts";

export const MIRRORED_STYLES = [
  "box-sizing", "width", "height", "direction", "text-align",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-style",
  "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "line-height",
  "text-transform", "text-indent", "word-spacing", "tab-size",
];

/**
 * Where the text caret of `el` is on screen. Runs inside the page via
 * `locator.evaluate(caretOf, MIRRORED_STYLES)`, so it can only use its arguments and browser globals.
 *
 * Inputs and textareas don't expose caret coordinates, so the text before the caret is copied
 * into a hidden element with the same styles and the end of that copy is measured.
 */
export function caretOf(el: Element, styles: string[]): Point {
  const rect = el.getBoundingClientRect();
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    const selection = getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : undefined;
    if (range?.height) return { x: range.right, y: range.top + range.height / 2 };
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  const singleLine = el instanceof HTMLInputElement;
  const computed = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const name of styles) mirror.style.setProperty(name, computed.getPropertyValue(name));
  Object.assign(mirror.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    visibility: "hidden",
    overflow: "hidden",
    whiteSpace: singleLine ? "pre" : "pre-wrap",
    overflowWrap: "break-word",
  });
  if (el.type === "password") mirror.style.setProperty("-webkit-text-security", "disc");
  mirror.textContent = el.value.slice(0, el.selectionEnd ?? el.value.length);
  const mark = document.createElement("span");
  mark.textContent = "​";
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const caret = mark.getBoundingClientRect();
  mirror.remove();

  const inside = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  return {
    x: inside(caret.left - el.scrollLeft, rect.left, rect.right),
    y: singleLine ? rect.top + rect.height / 2 : inside(caret.top + caret.height / 2 - el.scrollTop, rect.top, rect.bottom),
  };
}
