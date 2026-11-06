import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { parseScript, scriptJsonSchema } from "../src/format.ts";

const ok = (source: string) => {
  const { script, problems } = parseScript(source, "demo.yaml");
  expect(problems).toEqual([]);
  return script;
};
const problems = (source: string) => parseScript(source, "demo.yaml").problems;

describe("reading a script", () => {
  test("steps and kebab-case fields", () => {
    const script = ok(`
screens:
  admin:
    url: http://localhost:3000/admin
    frame: browser-safari
  member:
    url: http://localhost:3000/app
    frame: mobile-iphone
zoom: 1.6
zoom-hold-ms: 500
style:
  motion-blur: 0.2
  cursor:
    travel-ms: 600

steps:
  # Setup, not in the video
  - action: pause-recording

  - action: type
    target: "#email"
    text: admin@example.com
    delay-ms: 20

  - action: resume-recording

  - action: click
    target: text=Invite member
    zoom: true
    keep-in-view:
      - "#card"
    caption: Invite a new member

  - action: save
    as: link
    target: "#invite-link"
    attribute: href

  - action: switch
    screen: member

  - action: goto
    url: \${link}
`);
    expect(script.zoom).toBe(1.6);
    expect(script.zoomHoldMs).toBe(500);
    expect(script.style).toEqual({ motionBlur: 0.2, cursor: { travelMs: 600 } });
    expect(script.screens?.member).toEqual({ url: "http://localhost:3000/app", frame: "mobile-iphone" });
    expect(script.steps).toEqual([
      { action: "pause-recording" },
      { action: "type", target: "#email", text: "admin@example.com", delayMs: 20 },
      { action: "resume-recording" },
      { action: "click", target: "text=Invite member", zoom: true, keepInView: ["#card"], caption: "Invite a new member" },
      { action: "save", as: "link", target: "#invite-link", attribute: "href" },
      { action: "switch", screen: "member" },
      { action: "goto", url: "${link}" },
    ]);
  });

  test("JSON is read the same way", () => {
    const json = JSON.stringify({ url: "http://x", steps: [{ action: "click", target: "#a" }, { action: "wait", ms: 5, caption: "Hi" }] });
    expect(parseScript(json, "demo.json")).toEqual({
      script: { url: "http://x", steps: [{ action: "click", target: "#a" }, { action: "wait", ms: 5, caption: "Hi" }] },
      problems: [],
    });
  });

  test("the examples are valid", async () => {
    for await (const file of new Glob("examples/*.demo.yaml").scan()) {
      expect(parseScript(await Bun.file(file).text(), file).problems).toEqual([]);
    }
  });
});

describe("problems", () => {
  test("come all at once, by line, with the step and how to fix them", () => {
    expect(
      problems(`url: http://x
steps:
  - action: click
    taget: text=Invite member

  - action: goto
    url: \${link}

  - action: pause-recording
`),
    ).toEqual([
      'demo.yaml:4 step 1 (click): unknown field "taget". Did you mean "target"?',
      'demo.yaml:6 step 2 (goto): "${link}" is used before it\'s saved. Add a `save` step with `as: link` before this step',
      "demo.yaml:9 step 3 (pause-recording): pause-recording is never resumed. Add `- action: resume-recording` where the video should continue",
      "3 errors",
    ]);
  });

  test("point out YAML reading text as something else", () => {
    expect(problems(`url: http://x\nsteps:\n  - action: click\n    target: #save\n  - action: type\n    target: "#a"\n    text: 123\n`)).toEqual([
      'demo.yaml:4 step 1 (click): "target" must be text, not empty. Put quotes around it: "#save"',
      'demo.yaml:7 step 2 (type): "text" must be text, not 123. Put quotes around it: "123"',
      "2 errors",
    ]);
  });

  test("suggest names for typos and old camelCase fields", () => {
    expect(problems(`url: http://x\nstyle:\n  motionBlur: 0.5\nsteps:\n  - action: clik\n  - action: switch\n    screen: a\n    transition: slid\n`)).toEqual([
      'demo.yaml:3: unknown field "motionBlur". Did you mean "motion-blur"?',
      'demo.yaml:5 step 1 (clik): unknown action "clik". Did you mean "click"?',
      'demo.yaml:8 step 2 (switch): "transition": unknown value "slid". Did you mean "slide"?',
      "3 errors",
    ]);
  });

  test("catch steps without action, missing fields and options that don't belong", () => {
    expect(problems(`url: x\nsteps:\n  - click: "#a"\n  - action: type\n    target: "#a"\n  - pause-recording\n  - action: wait\n    ms: 1\n  - action: resume-recording\n    caption: x\n`)).toEqual([
      'demo.yaml:3 step 1 (click): the step is missing "action". Use one of: goto, click, hover, type, press, scroll, wait-for, wait, switch, save, pause-recording, resume-recording',
      'demo.yaml:4 step 2 (type): "type" is missing "text"',
      'demo.yaml:6 step 3 (pause-recording): a step must be fields starting with `- action: ...`, not "pause-recording"',
      'demo.yaml:10 step 5 (resume-recording): "resume-recording" takes no other fields. Remove "caption"',
      "4 errors",
    ]);
  });

  test("check save, screen names and values", () => {
    expect(problems(`screens:\n  "2nd":\n    url: x\nzoom: 0.5\nsteps:\n  - action: save\n    as: my-link\n    from: url\n    attribute: href\n  - action: save\n    as: x\n`)).toEqual([
      'demo.yaml:2: name "2nd" must start with a letter and use only letters, digits, - and _',
      'demo.yaml:4: "zoom" must be at least 1, not 0.5',
      'demo.yaml:6 step 1 (save): "attribute" only works with "target"',
      'demo.yaml:7 step 1 (save): "as" "my-link" can only use letters, digits and _',
      'demo.yaml:10 step 2 (save): save needs either "target" (an element) or "from" (url or clipboard)',
      "5 errors",
    ]);
  });

  test("broken YAML: the first error, with a hint about indentation or quotes", () => {
    expect(problems(`url: x\nsteps:\n  - action: type\n      target: "#email"\n      text: hi\n`)).toEqual([
      "demo.yaml:3: Nested mappings are not allowed in compact mappings. Check the indentation: a step's fields line up with `action:`",
      "1 error",
    ]);
    expect(problems(`url: x\nsteps:\n  - action: wait\n    ms: 1\n    caption: Note: this\n`)[0]).toEndWith("Put quotes around the value");
  });

  test("a step that can't be read doesn't cause errors about the steps around it", () => {
    expect(problems(`url: x\nsteps:\n  - action: pause-recordin\n  - action: resume-recording\n`)).toEqual([
      'demo.yaml:3 step 1 (pause-recordin): unknown action "pause-recordin". Did you mean "pause-recording"?',
      "1 error",
    ]);
    expect(problems(`url: x\nscreens:\n  a:\n    url: x\nsteps:\n  - action: switch\n    transition: slide\n`)).toEqual([
      'demo.yaml:6 step 1 (switch): "switch" is missing "screen"',
      "1 error",
    ]);
  });

  test("a field that takes true or a number says what's wrong with the number", () => {
    expect(problems(`url: x\nsteps:\n  - action: click\n    target: "#a"\n    zoom: 0.5\n`)[0]).toBe('demo.yaml:5 step 1 (click): "zoom" must be at least 1, not 0.5');
    expect(problems(`url: x\nsteps:\n  - action: click\n    target: "#a"\n    zoom: yes please\n`)[0]).toBe('demo.yaml:5 step 1 (click): "zoom" must be true or a number, not "yes please"');
  });

  test("a script without url or steps", () => {
    expect(problems("zoom: 2\n")).toEqual(['demo.yaml: missing "steps"', "demo.yaml: the script needs `url` (one page) or `screens`", "2 errors"]);
  });
});

test("the JSON Schema file is up to date (bun src/cli.ts schema > opendemo.schema.json)", async () => {
  expect(await Bun.file("opendemo.schema.json").json()).toEqual(JSON.parse(JSON.stringify(scriptJsonSchema())));
});
