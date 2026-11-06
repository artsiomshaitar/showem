/** A small schema language: checks a parsed script, turns kebab-case fields into camelCase, and describes itself as JSON Schema for editors. */

export type Schema =
  | { kind: "string"; values?: readonly string[]; pattern?: RegExp; patternHint?: string; doc?: string }
  | { kind: "number"; min?: number; max?: number; doc?: string }
  | { kind: "true"; doc?: string }
  | { kind: "either"; options: readonly Schema[]; expected: string; doc?: string }
  | { kind: "list"; items: Schema; doc?: string }
  | { kind: "object"; fields: Readonly<Record<string, Schema>>; required?: readonly string[]; doc?: string }
  /** An object whose keys are names the user picks, kept as they are. */
  | { kind: "named"; values: Schema; keyPattern?: RegExp; keyHint?: string; doc?: string };

export type Path = readonly (string | number)[];

export interface Issue {
  path: Path;
  message: string;
  /** Set when a text field got something else, so the caller can show what to put in quotes. */
  notText?: boolean;
}

export const text = (doc?: string, more: Partial<Extract<Schema, { kind: "string" }>> = {}): Schema => ({ kind: "string", doc, ...more });
export const oneOf = (values: readonly string[], doc?: string): Schema => ({ kind: "string", values, doc });
export const num = (doc?: string, more: { min?: number; max?: number } = {}): Schema => ({ kind: "number", doc, ...more });
export const list = (items: Schema, doc?: string): Schema => ({ kind: "list", items, doc });
export const object = (fields: Record<string, Schema>, required: readonly string[] = [], doc?: string): Extract<Schema, { kind: "object" }> => ({ kind: "object", fields, required, doc });

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Edits to turn `a` into `b`: adding, removing or changing a letter, or swapping two next to each other. */
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** The closest known name to `name`, if one is close enough to be a typo or an old camelCase name. */
function closest(name: string, known: readonly string[]): string | undefined {
  if (known.includes(kebab(name))) return kebab(name);
  let best: { name: string; d: number } | undefined;
  for (const k of known) {
    const d = distance(name.toLowerCase(), k);
    if (d <= Math.max(1, Math.floor(k.length / 3)) && (!best || d < best.d)) best = { name: k, d };
  }
  return best?.name;
}

export const didYouMean = (name: string, known: readonly string[]) => {
  const guess = closest(name, known);
  return guess ? `Did you mean "${guess}"?` : `Use one of: ${known.join(", ")}`;
};

export const describe = (value: unknown) =>
  value === null ? "empty" : Array.isArray(value) ? "a list" : typeof value === "object" ? "a group of fields" : typeof value === "string" ? `"${value}"` : String(value);

function expected(schema: Schema): string {
  switch (schema.kind) {
    case "string":
      return schema.values ? `one of: ${schema.values.join(", ")}` : "text";
    case "number":
      return "a number";
    case "true":
      return "true";
    case "either":
      return schema.expected;
    case "list":
      return "a list";
    case "object":
    case "named":
      return "a group of fields";
  }
}

/** How a message names the value at `path`: its field name, or which item of a list it is. */
function labelOf(path: Path): string {
  const last = path.at(-1);
  if (typeof last === "number") return `item ${last + 1} of ${labelOf(path.slice(0, -1))}`;
  return last === undefined ? "the script" : `"${last}"`;
}

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The kind of value a schema takes, in the terms of `kindOf`. */
const SCHEMA_KINDS: Record<Schema["kind"], string> = { string: "string", number: "number", true: "boolean", either: "either", list: "list", object: "object", named: "object" };

const kindOf = (value: unknown) => (Array.isArray(value) ? "list" : value === null ? "null" : typeof value);

/** Checks `value` against `schema`, adding what's wrong to `issues`. Returns the value with camelCase field names. */
export function check(schema: Schema, value: unknown, path: Path, issues: Issue[], name = labelOf(path)): unknown {
  const wrongType = () => {
    issues.push({ path, message: `${name} must be ${expected(schema)}, not ${describe(value)}`, notText: schema.kind === "string" && !schema.values });
    return undefined;
  };
  switch (schema.kind) {
    case "string":
      if (typeof value !== "string") return wrongType();
      if (schema.values && !schema.values.includes(value)) {
        issues.push({ path, message: `${name}: unknown value "${value}". ${didYouMean(value, schema.values)}` });
      } else if (schema.pattern && !schema.pattern.test(value)) {
        issues.push({ path, message: `${name} "${value}" ${schema.patternHint}` });
      }
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return wrongType();
      if (schema.min !== undefined && value < schema.min) issues.push({ path, message: `${name} must be at least ${schema.min}, not ${value}` });
      if (schema.max !== undefined && value > schema.max) issues.push({ path, message: `${name} must be at most ${schema.max}, not ${value}` });
      return value;
    case "true":
      return value === true ? value : wrongType();
    case "either": {
      // The option of the same kind as the value, so `zoom: 0.5` says it's too small, not that it isn't a number.
      const option = schema.options.find((o) => SCHEMA_KINDS[o.kind] === kindOf(value));
      return option ? check(option, value, path, issues, name) : wrongType();
    }
    case "list":
      if (!Array.isArray(value)) return wrongType();
      return value.map((item, i) => check(schema.items, item, [...path, i], issues));
    case "object": {
      if (!isObject(value)) return wrongType();
      const known = Object.keys(schema.fields);
      const out: Record<string, unknown> = {};
      const suggested = new Set<string>();
      for (const [key, item] of Object.entries(value)) {
        const field = schema.fields[key];
        if (!field) {
          const guess = closest(key, known);
          if (guess) suggested.add(guess);
          issues.push({ path: [...path, key], message: `unknown field "${key}". ${didYouMean(key, known)}` });
          continue;
        }
        out[camel(key)] = check(field, item, [...path, key], issues);
      }
      for (const key of schema.required ?? []) {
        if (!(key in value) && !suggested.has(key)) issues.push({ path, message: `${name} is missing "${key}"` });
      }
      return out;
    }
    case "named": {
      if (!isObject(value)) return wrongType();
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (schema.keyPattern && !schema.keyPattern.test(key)) issues.push({ path: [...path, key], message: `name "${key}" ${schema.keyHint}` });
        out[key] = check(schema.values, item, [...path, key], issues);
      }
      return out;
    }
  }
}

/** The schema as JSON Schema, for editor autocomplete and inline errors. */
export function jsonSchema(schema: Schema): Record<string, unknown> {
  const doc = schema.doc ? { description: schema.doc } : {};
  switch (schema.kind) {
    case "string":
      return { type: "string", ...(schema.values && { enum: schema.values }), ...(schema.pattern && { pattern: schema.pattern.source }), ...doc };
    case "number":
      return { type: "number", ...(schema.min !== undefined && { minimum: schema.min }), ...(schema.max !== undefined && { maximum: schema.max }), ...doc };
    case "true":
      return { const: true, ...doc };
    case "either":
      return { anyOf: schema.options.map(jsonSchema), ...doc };
    case "list":
      return { type: "array", items: jsonSchema(schema.items), ...doc };
    case "object":
      return {
        type: "object",
        properties: Object.fromEntries(Object.entries(schema.fields).map(([k, v]) => [k, jsonSchema(v)])),
        ...(schema.required?.length && { required: schema.required }),
        additionalProperties: false,
        ...doc,
      };
    case "named":
      return {
        type: "object",
        ...(schema.keyPattern && { propertyNames: { pattern: schema.keyPattern.source } }),
        additionalProperties: jsonSchema(schema.values),
        ...doc,
      };
  }
}
