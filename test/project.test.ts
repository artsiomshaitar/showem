import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { combine, loadScript, parseConfig } from "../src/format.ts";
import { buildDir, findProject, initProject } from "../src/project.ts";

let dir: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "showem-project-")));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

test("init creates the config, ignores videos and .env, and won't overwrite them", async () => {
  await initProject(dir);
  expect(await readFile(join(dir, ".showem/config.yaml"), "utf8")).toContain("# style:");
  expect(await readFile(join(dir, ".showem/.gitignore"), "utf8")).toBe("videos/\n.env\n");
  expect(parseConfig(await readFile(join(dir, ".showem/config.yaml"), "utf8"), "config.yaml")).toEqual({ config: {}, problems: [] });
  expect(initProject(dir)).rejects.toThrow("already exists");
});

const VOICE = "voice:\n  provider: elevenlabs\n  voice: abc\n  api-key: ${{ env.SHOWEM_TEST_KEY }}\n";

test("the API key comes from the variable the config names, and stays out of the config", () => {
  const { config, apiKey, problems } = parseConfig(VOICE, "config.yaml", (name) => (name === "SHOWEM_TEST_KEY" ? "sk_1" : undefined));
  expect(problems).toEqual([]);
  expect(apiKey).toBe("sk_1");
  expect(config.voice).toEqual({ provider: "elevenlabs", voice: "abc", apiKey: "${{ env.SHOWEM_TEST_KEY }}" });
});

test("a voice needs a provider or a base-url, a model, and a key for a provider", () => {
  const problems = (voice: string) => parseConfig(`voice:\n${voice}`, "config.yaml").problems;
  expect(problems("  voice: v\n  model: m\n")[0]).toBe('config.yaml:1: "voice" needs "provider" (elevenlabs, openai or openrouter), or "base-url" for any other server');
  expect(problems("  provider: openrouter\n  base-url: http://x/v1\n  model: m\n  voice: v\n  api-key: ${{ env.K }}\n")[0]).toBe('config.yaml:3: "openrouter" already knows its address. Remove "base-url", or remove "provider" to use another server');
  expect(problems("  provider: openai\n  voice: v\n")).toEqual(['config.yaml:1: "voice" needs "model"', 'config.yaml:1: "openai" needs "api-key", like ${{ env.API_KEY }}, with the key in .showem/.env', "2 errors"]);
  expect(problems("  provider: elevenlabs\n  voice: v\n  api-key: ${{ env.K }}\n  instructions: Warm\n")[0]).toStartWith('config.yaml:5: "instructions" doesn\'t work with elevenlabs');
  expect(problems("  base-url: http://localhost:8880/v1\n  model: kokoro\n  voice: af_heart\n  audio-tags: false\n  extra:\n    seed: 7\n    instruct: Calm\n")).toEqual([]);
});

test("a missing variable (when the key is needed) or a key written in the config is an error, without repeating the key", () => {
  expect(parseConfig(VOICE, "config.yaml", () => undefined).problems[0]).toBe("config.yaml:4: SHOWEM_TEST_KEY isn't set. Add it to .showem/.env or the environment");
  const literal = parseConfig(VOICE.replace("${{ env.SHOWEM_TEST_KEY }}", "sk_secret"), "config.yaml").problems[0];
  expect(parseConfig(VOICE, "config.yaml").problems).toEqual([]);
  expect(literal).toStartWith('config.yaml:4: "api-key" must name a variable');
  expect(literal).not.toContain("sk_secret");
});

test("a project's voice replaces the global one whole, key included, while other groups merge", () => {
  const global = { config: { voice: { provider: "elevenlabs" as const, voice: "g", apiKey: "${{ env.K }}" }, style: { padding: 0.1 } }, apiKey: "sk_global" };
  const project = { config: { voice: { baseUrl: "http://localhost:1/v1", model: "kokoro", voice: "af_heart" }, style: { radius: 0.02 } } };
  const { script, apiKey } = combine([global, project], { url: "http://x", steps: [] });
  expect(script.voice).toEqual({ baseUrl: "http://localhost:1/v1", model: "kokoro", voice: "af_heart" });
  expect(script.style).toEqual({ padding: 0.1, radius: 0.02 });
  expect(apiKey).toBeUndefined();
  expect(combine([global, { config: {} }], { url: "http://x", steps: [] }).apiKey).toBe("sk_global");
});

test("loadScript reads the key from .showem/.env, then from the project's .env", async () => {
  await Bun.write(join(dir, ".showem/config.yaml"), VOICE);
  await Bun.write(join(dir, ".env"), "SHOWEM_TEST_KEY=sk_root\n");
  await Bun.write(join(dir, "demo.yaml"), "url: http://x\nsteps: []\n");
  const key = async () => {
    const loaded = await loadScript(join(dir, "demo.yaml"), true);
    expect(JSON.stringify("script" in loaded && loaded.script)).not.toContain("sk_");
    return "apiKey" in loaded && loaded.apiKey;
  };
  expect(await key()).toBe("sk_root");
  await Bun.write(join(dir, ".showem/.env"), "SHOWEM_TEST_KEY=sk_showem\n");
  expect(await key()).toBe("sk_showem");
});

test("a script uses the project's config, and its own fields win", async () => {
  await Bun.write(join(dir, ".showem/config.yaml"), "style:\n  background: backgrounds/brand.jpg\n  padding: 0.05\nzoom: 2\noutput:\n  fps: 30\n");
  await Bun.write(join(dir, "demos/a.yaml"), "url: ../src/index.html\nstyle:\n  padding: 0.1\nsteps: []\n");
  await Bun.write(join(dir, "demos/b.yaml"), "url: ../src/index.html\nstyle:\n  background: ../art/launch.png\nsteps: []\n");

  const a = await loadScript(join(dir, "demos/a.yaml"));
  if (!("script" in a)) throw new Error(a.problems.join("\n"));
  expect(a.script.style).toEqual({ background: join(dir, ".showem/backgrounds/brand.jpg"), padding: 0.1 });
  expect(a.script.zoom).toBe(2);
  expect(a.script.output).toEqual({ fps: 30 });
  expect(a.outPath).toBe(join(dir, ".showem/videos/a.mp4"));

  const b = await loadScript(join(dir, "demos/b.yaml"));
  if (!("script" in b)) throw new Error(b.problems.join("\n"));
  expect(b.script.style).toEqual({ background: join(dir, "art/launch.png"), padding: 0.05 });
});

test("a config can't set what only a script can, and its problems name the file", () => {
  const { problems } = parseConfig("url: http://x\noutput:\n  path: a.mp4\n  fps: fast\n", ".showem/config.yaml");
  expect(problems).toEqual([
    '.showem/config.yaml:1: unknown field "url". Use one of: $schema, viewport, device-scale-factor, zoom, zoom-hold-ms, style, output, voice',
    '.showem/config.yaml:3: unknown field "path". Use one of: width, height, fps, bitrate',
    '.showem/config.yaml:4: "fps" must be a number, not "fast"',
    "3 errors",
  ]);
});

test("outside a project, the video goes next to the script", async () => {
  await Bun.write(join(dir, "demo.yaml"), "url: http://x\nsteps: []\n");
  const loaded = await loadScript(join(dir, "demo.yaml"));
  expect("outPath" in loaded && loaded.outPath).toBe(join(dir, "demo.mp4"));
});

test("findProject looks up from the folder, and build folders differ per video path", async () => {
  await mkdir(join(dir, ".showem"));
  await mkdir(join(dir, "a/b"), { recursive: true });
  expect(findProject(join(dir, "a/b"))).toBe(join(dir, ".showem"));
  expect(buildDir("/x/one/demo.mp4")).not.toBe(buildDir("/x/two/demo.mp4"));
  expect(buildDir("/x/one/demo.mp4")).toContain("demo.mp4-");
});
