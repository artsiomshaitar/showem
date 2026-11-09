import { join, resolve } from "node:path";
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Node } from "yaml";
import { check, describe, didYouMean, isObject, jsonSchema, list, num, object, oneOf, text, type Issue, type Path, type Schema } from "./schema.ts";
import { checkScript, resolveScript } from "./script.ts";
import { FRAMES, TRANSITIONS, type Script, type Step } from "./types.ts";

const target = text("The element, as a Playwright selector: `text=Save`, `#id`, `button:has-text(\"Save\")`, `[data-testid=x]`. Quote selectors that start with #.");
const zoom: Schema = {
  kind: "either",
  options: [{ kind: "true" }, num(undefined, { min: 1 })],
  expected: "true or a number",
  doc: "Zoom in on the target: `true` uses the script's `zoom` scale, a number zooms to that scale.",
};
const keepInView = list(target, "Other elements to keep in frame with the target while zoomed, usually what the step changes (a new row, a toast). Needs `zoom`.");
const caption = text("Text shown before the step runs, until the next caption. The step waits until it can be read.");
const size = (what: string) => object({ width: num(undefined, { min: 1 }), height: num(undefined, { min: 1 }) }, ["width", "height"], what);

export interface ActionSpec {
  doc: string;
  fields?: Record<string, Schema>;
  required?: string[];
  /** One or more steps showing the action, as YAML list items. */
  example: string;
}

export const ACTIONS: Record<Step["action"], ActionSpec> = {
  goto: {
    doc: "Open a URL.",
    fields: { url: text("A full URL, or a path relative to the current page.") },
    required: ["url"],
    example: "- action: goto\n  url: /settings",
  },
  click: {
    doc: "Move the pointer to an element and click it. On a phone screen, tap it.",
    fields: { target, zoom, "keep-in-view": keepInView },
    required: ["target"],
    example: "- action: click\n  target: text=Add task\n  zoom: true\n  keep-in-view:\n    - \"#list li:last-child\"\n  caption: Add it to the list",
  },
  hover: {
    doc: "Move the pointer over an element without clicking.",
    fields: { target, zoom, "keep-in-view": keepInView },
    required: ["target"],
    example: "- action: hover\n  target: \"#help\"\n  caption: Tips are one hover away",
  },
  type: {
    doc: "Click an input and type into it, one key at a time. On a native date or time input it types the value into the input's parts (day, hour, AM/PM) the way a person would.",
    fields: { target, text: text("What to type. For a native date or time input, the value: `14:00` or `2:00 PM`, `2026-11-07`, `2026-11-07T14:00`."), "delay-ms": num("Pause between keys. Default: 60.", { min: 0 }), zoom, "keep-in-view": keepInView },
    required: ["target", "text"],
    example: "- action: type\n  target: \"#name\"\n  text: Launch plan\n  zoom: 1.6\n  caption: Name the project",
  },
  select: {
    doc: "Pick an option from a dropdown. On a native `<select>` the pointer opens a menu drawn in the video (the browser doesn't film its own) and clicks the option. On a dropdown made of page elements it clicks the target, then the option.",
    fields: { target: text("The `<select>`, or the element that opens the dropdown, as a Playwright selector."), option: text("The option's visible text, exactly as shown."), zoom, "keep-in-view": keepInView },
    required: ["target", "option"],
    example: "- action: select\n  target: \"#reason\"\n  option: Waiting on parts\n  zoom: true\n  caption: Pick the reason",
  },
  press: {
    doc: "Press a key or a key combination.",
    fields: { key: text("A key name as Playwright writes it: Enter, Tab, Escape, ArrowDown, Meta+A.") },
    required: ["key"],
    example: "- action: press\n  key: Enter",
  },
  scroll: {
    doc: "Scroll the page: smoothly until an element is in view, centered if it had to move (`target`), or by a number of pixels with the mouse wheel (`y`). Steps that point at an element already scroll to it, so use this to show something without pointing at it.",
    fields: {
      target: text("The element to bring into view, as a Playwright selector. Use this or `y`."),
      y: num("Pixels to scroll with the mouse wheel: positive goes down, negative goes up. Use this or `target`."),
    },
    example: "- action: scroll\n  target: text=Updates\n  caption: Every change is listed",
  },
  "wait-for": {
    doc: "Wait until an element is visible. Use it after anything that loads.",
    fields: { target: text("The element to wait for, as a Playwright selector.") },
    required: ["target"],
    example: "- action: wait-for\n  target: text=Saved",
  },
  wait: {
    doc: "Wait, so the viewer can take in what is on screen.",
    fields: { ms: num("How long, in milliseconds.", { min: 0 }) },
    required: ["ms"],
    example: "- action: wait\n  ms: 1200\n  caption: The dashboard at a glance",
  },
  switch: {
    doc: "Move the video to another screen. The steps after it run there.",
    fields: {
      screen: text("The name of a screen from `screens`."),
      transition: oneOf(TRANSITIONS, "How the video moves there: fade (default) or slide. A slide goes left to a screen listed later in `screens`, right to one listed earlier."),
    },
    required: ["screen"],
    example: "- action: switch\n  screen: phone\n  transition: slide\n  caption: It shows up on the phone",
  },
  save: {
    doc: "Store a value that only exists while the script runs (a link, an ID it just created). Later steps use it as `${name}` in any text. Takes no time in the video.",
    fields: {
      as: text("The name later steps use as `${name}`. Letters, digits and _.", { pattern: /^\w+$/, patternHint: "can only use letters, digits and _" }),
      target: text("The element to read, as a Playwright selector. Its text is stored, or its `attribute`."),
      attribute: text("An attribute of the target to store instead of its text, like href or value. href and src come back as full URLs."),
      from: oneOf(["url", "clipboard"], "Store the current page URL, or the clipboard (after a step that copies). Use instead of `target`."),
    },
    required: ["as"],
    example: "- action: save\n  as: link\n  target: \"#share-link\"\n  attribute: href\n\n- action: goto\n  url: ${link}",
  },
  "zoom-in": {
    doc: "Zoom the camera in on an element (a form, a dialog, a menu, a table row) and stay zoomed for the steps after it, until `zoom-out`, a `goto` or a `switch`. The camera follows the steps inside it. It waits a moment so the camera gets there before the next step.",
    fields: {
      target: text("The element to zoom in on, as a Playwright selector."),
      scale: num("Default: the script's `zoom` scale.", { min: 1 }),
      "keep-in-view": list(target, "Other elements to keep in frame with the target, measured when the zoom starts. The camera centers on all of them and zooms out below the scale if they don't fit."),
    },
    required: ["target"],
    example: "- action: zoom-in\n  target: \"#name\"\n  keep-in-view:\n    - text=Save\n  caption: Fill in the details\n\n- action: type\n  target: \"#name\"\n  text: Launch plan\n\n- action: click\n  target: text=Save\n\n- action: zoom-out",
  },
  "zoom-out": {
    doc: "Zoom the camera back out to the whole page after `zoom-in`.",
    example: "- action: zoom-out",
  },
  "pause-recording": {
    doc: "Stop recording, like the pause button on a screen recorder. The steps after it still run, at full speed, but aren't in the video. Use it for setup the viewer doesn't need to see. They can't have captions or zoom.",
    example: "- action: pause-recording\n\n- action: click\n  target: text=Dismiss\n\n- action: resume-recording",
  },
  "resume-recording": {
    doc: "Continue recording after pause-recording. If a paused `switch` moved to another screen, the video moves there using that switch's transition and caption.",
    example: "- action: wait\n  ms: 1000\n\n- action: pause-recording\n\n- action: switch\n  screen: phone\n  transition: slide\n  caption: Meanwhile, on the phone\n\n- action: resume-recording",
  },
};
const ACTION_NAMES = Object.keys(ACTIONS);

export const TOP = object({
  $schema: text("A JSON Schema for editors. Ignored by showem."),
  url: text("The page to record. Use this or `screens`."),
  screens: {
    kind: "named",
    keyPattern: /^[A-Za-z][\w-]*$/,
    keyHint: "must start with a letter and use only letters, digits, - and _",
    values: object(
      {
        url: text("The page this screen opens first."),
        frame: oneOf(FRAMES, "browser-safari (default), browser-chrome, mobile-iphone or none. Phones show taps instead of a cursor."),
        viewport: size("The page size in CSS pixels. Default: the top-level viewport. Not for phone frames, which have their own size."),
      },
      ["url"],
    ),
    doc: "Named screens, each its own browser page with its own cookies. The first one is on camera at the start. Use this or `url`.",
  },
  viewport: size("The page size in CSS pixels. Default: 1440 x 900."),
  "device-scale-factor": num("Pixel density of the recording. Default: 3.", { min: 1 }),
  zoom: num("The scale of `zoom: true` steps and `zoom-in`. Default: 1.8.", { min: 1 }),
  "zoom-hold-ms": num("How long the camera stays zoomed after a step ends. Default: 300.", { min: 0 }),
  output: object(
    {
      path: text("Where to write the video. `--out` on the command line overrides it. Default: the script's name with .mp4, or showem.mp4 for a script from stdin."),
      width: num("Default: 2560.", { min: 1 }),
      height: num("Default: 1440.", { min: 1 }),
      fps: num("Default: 60.", { min: 1 }),
    },
    [],
    "The video file.",
  ),
  style: object(
    {
      background: text("An image file shown behind the window."),
      padding: num("Space around the window, as a share of the video size. Default: 0.08.", { min: 0 }),
      radius: num("Corner radius of the window, as a share of the video size. Default: 0.018.", { min: 0 }),
      shadow: num("Window shadow, 0 to 1. Default: 0.6.", { min: 0, max: 1 }),
      "motion-blur": num("0 (off) to 1 (strong), only while the camera or cursor moves. Default: 0.5.", { min: 0, max: 1 }),
      cursor: object({ size: num("Default: 1.", { min: 0 }), "travel-ms": num("Longest time the pointer takes to move to a target. Default: 800.", { min: 0 }) }, [], "The pointer."),
      captions: object({ "font-size": num("In video pixels. Default: 3% of the video height.", { min: 1 }) }, [], "Caption text."),
    },
    [],
    "How the video looks. Changing it only needs `showem render`.",
  ),
});

export const fieldsOf = (name: string, spec: ActionSpec) => object({ action: oneOf([name]), ...spec.fields, ...(spec.fields && { caption }) }, ["action", ...(spec.required ?? [])]);

function readStep(raw: unknown, path: Path, issues: Issue[]): Step | undefined {
  if (!isObject(raw)) return void issues.push({ path, message: `a step must be fields starting with \`- action: ...\`, not ${describe(raw)}` });
  if (!("action" in raw)) return void issues.push({ path, message: `the step is missing "action". Use one of: ${ACTION_NAMES.join(", ")}` });
  const name = raw.action;
  if (typeof name !== "string" || !Object.hasOwn(ACTIONS, name)) {
    return void issues.push({ path: [...path, "action"], message: `unknown action ${describe(name)}. ${didYouMean(String(name), ACTION_NAMES)}` });
  }
  const spec = ACTIONS[name as Step["action"]];
  if (!spec.fields) {
    const extra = Object.keys(raw).filter((k) => k !== "action");
    if (extra.length) issues.push({ path: [...path, extra[0]!], message: `"${name}" takes no other fields. Remove ${extra.map((k) => `"${k}"`).join(", ")}` });
    return { action: name } as Step;
  }
  const step = check(fieldsOf(name, spec), raw, path, issues, `"${name}"`) as Step;
  if (step.action === "save" && ("target" in step) === ("from" in step)) issues.push({ path, message: `save needs either "target" (an element) or "from" (url or clipboard)` });
  if (step.action === "scroll" && ("target" in step) === ("y" in step)) issues.push({ path, message: `scroll needs either "target" (an element to bring into view) or "y" (pixels)` });
  if (step.action === "save" && "from" in step && "attribute" in step) issues.push({ path, message: `"attribute" only works with "target"` });
  return step;
}

/** Checks the parsed script, returning it in the internal shape and every problem found, each with the path where it is. */
function readScript(raw: unknown): { script: Script; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isObject(raw)) {
    issues.push({ path: [], message: `the script must be a group of fields with \`steps\`, not ${describe(raw)}` });
    return { script: { steps: [] }, issues };
  }
  const { steps, ...rest } = raw;
  const { $schema: _, ...top } = check(TOP, rest, [], issues) as Omit<Script, "steps"> & { $schema?: string };
  if (steps === undefined) issues.push({ path: [], message: `missing "steps"` });
  else if (!Array.isArray(steps)) issues.push({ path: ["steps"], message: `"steps" must be a list, not ${describe(steps)}` });
  const read = (Array.isArray(steps) ? steps : []).map((step, i) => readStep(step, ["steps", i], issues));
  const script: Script = { ...top, steps: read.filter((step) => step !== undefined) };
  // With a step missing, pauses and saved values can't be followed, so those checks wait until every step can be read.
  if (read.length !== script.steps.length) return { script, issues };
  const broken = new Set(issues.flatMap((issue) => (issue.path[0] === "steps" && typeof issue.path[1] === "number" ? [issue.path[1]] : [])));
  for (const p of checkScript(script)) {
    if (p.step === undefined) issues.push({ path: [], message: p.message });
    // A step with a wrong field gets that error only, not a second one caused by it.
    else if (!broken.has(p.step)) issues.push({ path: ["steps", p.step], message: p.message });
  }
  return { script, issues };
}

/** Finds where `path` is in the document: the line of its key, or of the item in a list. */
function locate(root: Node | null, path: Path): { offset?: number; node?: Node } {
  let node: unknown = root;
  let offset: number | undefined;
  for (const key of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && p.key.value === key);
      if (!pair) break;
      offset = (pair.key as Node).range?.[0];
      node = pair.value;
    } else if (isSeq(node) && typeof key === "number") {
      node = node.items[key];
      offset = (node as Node | undefined)?.range?.[0];
    } else {
      break;
    }
  }
  return { offset, node: node as Node };
}

/** A hint for a value that should be text: YAML read `#id` as a comment, or a number or `yes` as something else. */
function quoteHint(node: Node | undefined): string {
  if (!isScalar(node)) return "";
  if (node.value === null && node.comment) return `. Put quotes around it: "#${node.comment.trim()}"`;
  if (node.value !== null && node.source) return `. Put quotes around it: "${node.source}"`;
  return "";
}

/** Reads a YAML or JSON script and checks it. Problems come as `name:line step N (action): message` lines. `stepAt` names a step the same way. */
export function parseScript(source: string, name: string): { script: Script; problems: string[]; stepAt: (index: number) => string } {
  const lines = new LineCounter();
  const doc = parseDocument(source, { lineCounter: lines, prettyErrors: false });
  const lineAt = (offset: number) => lines.linePos(offset).line;
  if (doc.errors.length) {
    const error = doc.errors[0]!;
    const line = lineAt(error.pos[0]);
    return { script: { steps: [] }, problems: [`${name}:${line}: ${error.message}${parseHint(source, line)}`, count(1)], stepAt: () => name };
  }
  const raw: unknown = doc.toJS();
  const { script, issues } = readScript(raw);
  const steps = isObject(raw) && Array.isArray(raw.steps) ? raw.steps : [];
  const where = (line: number, index: number | undefined) => `${name}${line ? `:${line}` : ""}${index === undefined ? "" : ` step ${index + 1}${stepName(steps[index])}`}`;
  const problems = issues
    .map((issue) => {
      const { offset, node } = locate(doc.contents, issue.path);
      const line = offset === undefined ? 0 : lineAt(offset);
      const index = issue.path[0] === "steps" && typeof issue.path[1] === "number" ? issue.path[1] : undefined;
      return { line, text: `${where(line, index)}: ${issue.message}${issue.notText ? quoteHint(node) : ""}` };
    })
    .sort((a, b) => a.line - b.line)
    .map((p) => p.text);
  const stepAt = (index: number) => {
    const { offset } = locate(doc.contents, ["steps", index]);
    return where(offset === undefined ? 0 : lineAt(offset), index);
  };
  return { script, problems: problems.length ? [...problems, count(problems.length)] : [], stepAt };
}

/** Most broken YAML in a script is a value that needs quotes, or step fields indented more than `action:`. */
function parseHint(source: string, line: number) {
  if (source.trimStart().startsWith("{")) return "";
  const text = source.split("\n")[line - 1] ?? "";
  if (/:\s.*:\s/.test(text) || /:\s+[@*&!{[`|>%]/.test(text)) return `. Put quotes around the value`;
  return ". Check the indentation: a step's fields line up with `action:`";
}

const count = (n: number) => `${n} error${n === 1 ? "" : "s"}`;

function stepName(raw: unknown) {
  const action = typeof raw === "string" ? raw : isObject(raw) ? (typeof raw.action === "string" ? raw.action : Object.keys(raw)[0]) : undefined;
  return action ? ` (${action})` : "";
}

/** Reads a script from a file, or from stdin when `arg` is `-`. Relative paths in a script from stdin resolve from the current folder. */
export async function loadScript(arg: string) {
  const stdin = arg === "-";
  const path = stdin ? join(process.cwd(), "showem.yaml") : resolve(arg);
  const source = stdin ? await Bun.stdin.text() : await Bun.file(path).text();
  const { script, problems, stepAt } = parseScript(source, stdin ? "<stdin>" : arg);
  if (problems.length) return { problems };
  return { problems, stepAt, ...resolveScript(script, path) };
}

/** JSON Schema for the script format, for editor autocomplete and inline errors. */
export function scriptJsonSchema() {
  const top = jsonSchema(TOP) as { properties: Record<string, unknown> };
  const steps = Object.entries(ACTIONS).map(([name, spec]) => ({ ...jsonSchema(fieldsOf(name, spec)), description: spec.doc }));
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "showem script",
    ...top,
    properties: { ...top.properties, steps: { type: "array", items: { anyOf: steps } } },
    required: ["steps"],
  };
}
