import { expect, test } from "bun:test";
import { version } from "../package.json";

function cli(args: string[], stdin: string) {
  const proc = Bun.spawnSync(["bun", "src/cli.ts", ...args], { stdin: new TextEncoder().encode(stdin) });
  return { code: proc.exitCode, out: proc.stdout.toString().trim() };
}

test("check reads a script from stdin and prints OK", () => {
  expect(cli(["check", "-"], "url: http://x\nsteps:\n  - action: wait\n    ms: 100\n")).toEqual({ code: 0, out: "OK" });
});

test("check exits with an error and lists every problem", () => {
  expect(cli(["check", "-"], "url: http://x\nsteps:\n  - action: wait\n    ms: 1\n    caption: 2\n  - action: goto\n    url: '${a}'\n")).toEqual({
    code: 1,
    out: ['<stdin>:5 step 1 (wait): "caption" must be text, not 2. Put quotes around it: "2"', '<stdin>:6 step 2 (goto): "${a}" is used before it\'s saved. Add a `save` step with `as: a` before this step', "2 errors", "Run `showem docs <action>` for an action's fields and an example."].join("\n"),
  });
});

test("run stops before recording when the script has problems", () => {
  expect(cli(["run", "-"], "steps: []\n").code).toBe(1);
});

test("docs prints the format, one action, or an error with a suggestion", () => {
  expect(cli(["docs"], "").out).toContain("Run `showem docs <action>`");
  expect(cli(["docs", "click"], "").out).toStartWith("click: ");
  expect(cli(["docs", "clik"], "").code).toBe(1);
});

test("check reports a step with a missing field instead of crashing", () => {
  expect(cli(["check", "-"], "url: http://x\nsteps:\n  - action: goto\n").out).toStartWith('<stdin>:3 step 1 (goto): "goto" is missing "url"');
});

test("--out needs a path", () => {
  expect(cli(["check", "-", "--out"], "url: http://x\nsteps: []\n").code).toBe(1);
  expect(cli(["check", "-", "--out", "a.mp4"], "url: http://x\nsteps: []\n")).toEqual({ code: 0, out: "OK" });
});

test("-v prints the version and -h prints the help", () => {
  expect(cli(["-v"], "")).toEqual({ code: 0, out: version });
  expect(cli(["--version"], "")).toEqual({ code: 0, out: version });
  expect(cli(["-h"], "").out).toStartWith("Usage: showem");
  expect(cli(["--help"], "").code).toBe(0);
});
