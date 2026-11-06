import { expect, test } from "bun:test";
import { actionDocs, overview } from "../src/docs.ts";
import { ACTIONS, parseScript, TOP } from "../src/format.ts";
import type { Schema } from "../src/schema.ts";

/** Fields without a description, as `parent.child`. Fields of a group without any docs (like a size) count as described by the group. */
function undocumented(schema: Schema, path: string): string[] {
  const own = schema.doc ? [] : [path];
  if (schema.kind === "named") return [...own, ...undocumented(schema.values, `${path}.<name>`).filter((p) => p !== `${path}.<name>`)];
  if (schema.kind !== "object") return own;
  const fields = Object.entries(schema.fields);
  if (fields.every(([, f]) => !f.doc)) return own;
  return [...(path ? own : []), ...fields.flatMap(([key, field]) => undocumented(field, path ? `${path}.${key}` : key))];
}

test("every field and action has a description", () => {
  expect(undocumented(TOP, "")).toEqual([]);
  for (const [name, spec] of Object.entries(ACTIONS)) {
    expect(spec.doc).not.toBe("");
    expect(Object.entries(spec.fields ?? {}).flatMap(([key, field]) => undocumented(field, `${name}.${key}`))).toEqual([]);
  }
});

test("every action's example is a valid script", () => {
  for (const [name, spec] of Object.entries(ACTIONS)) {
    const script = `screens:\n  desk:\n    url: http://x\n  phone:\n    url: http://y\n\nsteps:\n${spec.example.replace(/^(?=.)/gm, "  ")}\n`;
    expect({ name, problems: parseScript(script, `${name}.yaml`).problems }).toEqual({ name, problems: [] });
  }
});

test("the overview's example is a valid script", () => {
  const example = overview().split("Example:\n")[1]!.split("\n\nRun")[0]!.replace(/^ {2}/gm, "");
  expect(parseScript(example, "example.yaml").problems).toEqual([]);
});

test("an action's docs list its fields, the caption, and an example", () => {
  const docs = actionDocs("type");
  expect(docs).toStartWith("type: Click an input");
  expect(docs).toMatch(/^ {2}target +required +text /m);
  expect(docs).toMatch(/^ {2}text +required +text /m);
  expect(docs).toMatch(/^ {2}caption +text /m);
  expect(docs).toContain("Example:\n  - action: type\n");
  expect(actionDocs("resume-recording")).toContain("No fields.");
  expect(() => actionDocs("clik")).toThrow('unknown action "clik". Did you mean "click"?');
});

test("the skill names every action", async () => {
  const skill = await Bun.file("skill/opendemo/SKILL.md").text();
  expect(Object.keys(ACTIONS).filter((name) => !skill.includes(`\`${name}\``))).toEqual([]);
});
