import { expect, test } from "bun:test";
import { completion } from "../src/completion.ts";

const COMMANDS = ["check", "try", "run", "docs"];

/** Runs `_showem` in bash for a command line and returns what it offers. */
function bash(...words: string[]) {
  const script = `${completion("bash", COMMANDS)}
COMP_WORDS=(${words.map((w) => `'${w}'`).join(" ")}); COMP_CWORD=${words.length - 1}; _showem; echo "\${COMPREPLY[*]}"`;
  return Bun.spawnSync(["bash", "-c", script]).stdout.toString().trim();
}

/** Runs `_showem` in zsh with `compadd` and `_files` stubbed, and returns what it offers. zsh filters by the typed prefix itself. */
function zsh(...words: string[]) {
  const script = `compdef() { :; }
${completion("zsh", COMMANDS)}
compadd() { [[ $1 == -- ]] && shift; print -rn -- "$* "; }
_files() { print -rn -- "<$*> "; }
words=(${words.map((w) => `'${w}'`).join(" ")}); CURRENT=${words.length}; _showem`;
  return Bun.spawnSync(["zsh", "-f", "-c", script]).stdout.toString().trim();
}

test("bash completes commands, docs actions, shells and --out", () => {
  expect(bash("showem", "d")).toBe("docs");
  expect(bash("showem", "docs", "cl")).toBe("click");
  expect(bash("showem", "completion", "b")).toBe("bash");
  expect(bash("showem", "run", "--o")).toBe("--out");
  expect(bash("showem", "check", "--o")).toBe("");
});

test("zsh offers commands, docs actions, and script or video files", () => {
  expect(zsh("showem", "d")).toStartWith("check try run docs");
  expect(zsh("showem", "docs", "cl")).toContain("click");
  expect(zsh("showem", "run", "x")).toBe("--out <-g *.(yaml|yml|json)>");
  expect(zsh("showem", "run", "--out", "x")).toBe("<-g *.mp4>");
  expect(zsh("showem", "check", "x")).toBe("<-g *.(yaml|yml|json)>");
});

