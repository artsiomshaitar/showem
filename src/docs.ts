import { ACTIONS, fieldsOf, TOP, type ActionSpec } from "./format.ts";
import { didYouMean, type Schema } from "./schema.ts";
import type { Step } from "./types.ts";

interface Row {
  name: string;
  type: string;
  required: boolean;
  doc: string;
}

function typeName(schema: Schema): string {
  switch (schema.kind) {
    case "string":
      return schema.values ? "choice" : "text";
    case "number":
      return "number";
    case "true":
      return "true";
    case "either":
      return schema.options.map(typeName).join(" | ");
    case "list":
      return `list of ${typeName(schema.items)}`;
    case "object":
      return `fields: ${Object.keys(schema.fields).join(", ")}`;
    case "named":
      return "fields";
  }
}

function docOf(schema: Schema) {
  const doc = schema.doc ?? "";
  const values = schema.kind === "string" ? schema.values : undefined;
  return values && !values.every((v) => doc.includes(v)) ? `${doc} One of: ${values.join(", ")}.`.trim() : doc;
}

/** Every field under `schema`, nested ones as `parent.child`. A group whose fields have no docs of their own (like a size) is one row. */
function rows(schema: Schema, prefix = "", required = false): Row[] {
  const row = { name: prefix, type: typeName(schema), required, doc: docOf(schema) };
  if (schema.kind === "named") return [row, ...rows(schema.values, `${prefix}.<name>`).filter((r) => r.name !== `${prefix}.<name>`)];
  if (schema.kind !== "object" || Object.values(schema.fields).every((f) => !f.doc)) return [row];
  return [
    ...(prefix ? [{ ...row, type: "fields" }] : []),
    ...Object.entries(schema.fields).flatMap(([key, field]) => rows(field, prefix ? `${prefix}.${key}` : key, schema.required?.includes(key) ?? false)),
  ];
}

function table(list: readonly Row[]) {
  const name = Math.max(...list.map((r) => r.name.length));
  const type = Math.max(...list.map((r) => r.type.length));
  return list
    .map((r) => `  ${r.name.padEnd(name)}  ${r.required ? "required " : "         "} ${r.type.padEnd(type)}  ${r.doc}`.trimEnd())
    .join("\n");
}

const indent = (text: string) => text.replace(/^(?=.)/gm, "  ");

const STEPS = `Each step is a list item that starts with \`action:\`. Its other fields go on the lines below, lined up with \`action:\`.
Every step except pause-recording and resume-recording can have a \`caption\`. Any text can use \`\${name}\` for a value stored earlier by \`save\`.
Write one field per line and put a blank line between steps.`;

const EXAMPLE = `url: http://localhost:3000

steps:
  - action: wait
    ms: 1000
    caption: The dashboard at a glance

  - action: click
    target: text=New project
    zoom: true
    caption: Create a project

  - action: wait-for
    target: text=Untitled project`;

/** The script format: top-level fields, how steps are written, and the actions. */
export function overview() {
  const width = Math.max(...Object.keys(ACTIONS).map((name) => name.length));
  const actions = Object.entries(ACTIONS).map(([name, spec]) => `  ${name.padEnd(width)}  ${spec.doc.split(". ")[0]!.replace(/\.$/, "")}.`);
  return `An OpenDemo script is YAML (or JSON) with these fields:

${table([...rows(TOP).filter((r) => r.name !== "$schema"), { name: "steps", type: "list of steps", required: true, doc: "What happens, in order." }])}

${STEPS}

Actions:
${actions.join("\n")}

Example:
${indent(EXAMPLE)}

Run \`opendemo docs <action>\` for an action's fields and an example.`;
}

/** One action: what it does, its fields and an example. */
export function actionDocs(name: string): string {
  if (!Object.hasOwn(ACTIONS, name)) throw new Error(`unknown action "${name}". ${didYouMean(name, Object.keys(ACTIONS))}`);
  const spec: ActionSpec = ACTIONS[name as Step["action"]];
  const schema = fieldsOf(name, spec);
  const fields = Object.entries(schema.fields)
    .filter(([key]) => key !== "action")
    .flatMap(([key, field]) => rows(field, key, schema.required?.includes(key) ?? false));
  return `${name}: ${spec.doc}

${fields.length ? `Fields:\n${table(fields)}` : "No fields."}

Example:
${indent(spec.example)}`;
}
