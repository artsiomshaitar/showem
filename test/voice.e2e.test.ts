import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureTool } from "../src/deps.ts";
import { record } from "../src/record.ts";
import { render } from "../src/render.ts";
import { buildCaptions } from "../src/plan.ts";
import { recordingKey, resolveScript, shownCaption, withoutTags } from "../src/script.ts";
import type { Script } from "../src/types.ts";
import { describeVoice, pruneVoiceCache, speaker, type Clip } from "../src/voice.ts";
import { makeRecording, makeScript } from "./fixtures.ts";

let dir: string;
let tone: ArrayBuffer;
const VOICE = { provider: "elevenlabs", voice: "v1", apiKey: "${{ env.KEY }}" } as const;

/** An MP3 of `seconds` of tone, made with the ffmpeg showem uses. */
async function mp3(seconds: number) {
  const proc = Bun.spawn([await ensureTool("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-f", "mp3", "-"], { stdout: "pipe" });
  return new Response(proc.stdout).arrayBuffer();
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "showem-voice-"));
  await Bun.write(join(dir, "page.html"), "<body><button id=b>Go</button></body>");
  tone = await mp3(1.5);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

test("speaker asks ElevenLabs once per caption, with its neighbors, then reads the clip from the cache", async () => {
  const requests: { url: string; key: string | null; body: unknown }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      requests.push({ url: new URL(req.url).pathname, key: req.headers.get("xi-api-key"), body: await req.json() });
      return new Response(tone);
    },
  });
  try {
    const cache = join(dir, "cache");
    const api = `http://localhost:${server.port}/v1`;
    const clip = await speaker(VOICE, "sk_test", cache, api)("[warmly] Hello there", { next: "Bye." });
    expect(clip.ms).toBeGreaterThan(1400);
    expect(clip.ms).toBeLessThan(1700);
    expect(requests).toEqual([{ url: "/v1/text-to-speech/v1", key: "sk_test", body: { text: "[warmly] Hello there", model_id: "eleven_v4", next_text: "Bye." } }]);
    // A new run, so nothing is shared in memory: the file is reused.
    expect(await speaker(VOICE, "sk_test", cache, api)("[warmly] Hello there", { next: "Bye." })).toEqual(clip);
    expect(requests.length).toBe(1);
    // A model that would say the tags gets the captions without them.
    await speaker({ ...VOICE, model: "eleven_multilingual_v2" }, "sk_test", cache, api)("[warmly] Hello there", { previous: "Hi [sighs]." });
    expect(requests[1]!.body).toEqual({ text: "Hello there", model_id: "eleven_multilingual_v2", previous_text: "Hi." });
  } finally {
    server.stop(true);
  }
});

test("a failed request names the text and the error", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response('{"detail":"invalid_api_key"}', { status: 401 }) });
  try {
    expect(speaker(VOICE, "bad", join(dir, "cache-bad"), `http://localhost:${server.port}/v1`)("Hi")).rejects.toThrow('elevenlabs couldn\'t read "Hi": 401 {"detail":"invalid_api_key"}');
  } finally {
    server.stop(true);
  }
});

test("other services get OpenAI's speech API: model, voice, instructions, and captions without tags", async () => {
  const requests: { url: string; auth: string | null; body: unknown }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      requests.push({ url: new URL(req.url).pathname, auth: req.headers.get("authorization"), body: await req.json() });
      return new Response(tone);
    },
  });
  try {
    const base = `http://localhost:${server.port}/v1`;
    await speaker({ provider: "openai", model: "gpt-4o-mini-tts", voice: "coral", instructions: "Warm." }, "sk_o", join(dir, "o"), base)("[warmly] Hi there.", { next: "Bye." });
    // A local server: no key, so no authorization header.
    await speaker({ baseUrl: base, model: "kokoro", voice: "af_heart", extra: { instruct: "Calm." } }, undefined, join(dir, "k"))("Hi there.");
    // A model the config says performs tags keeps them.
    await speaker({ baseUrl: base, model: "x", voice: "v", audioTags: true }, undefined, join(dir, "x"))("[warmly] Hi.");
    expect(requests).toEqual([
      { url: "/v1/audio/speech", auth: "Bearer sk_o", body: { model: "gpt-4o-mini-tts", voice: "coral", input: "Hi there.", response_format: "mp3", instructions: "Warm." } },
      { url: "/v1/audio/speech", auth: null, body: { model: "kokoro", voice: "af_heart", input: "Hi there.", response_format: "mp3", instruct: "Calm." } },
      { url: "/v1/audio/speech", auth: null, body: { model: "x", voice: "v", input: "[warmly] Hi.", response_format: "mp3" } },
    ]);
  } finally {
    server.stop(true);
  }
});

test("a server that isn't running says so", async () => {
  expect(speaker({ baseUrl: "http://localhost:1/v1", model: "kokoro", voice: "af_heart" }, undefined, join(dir, "none"))("Hi")).rejects.toThrow("Is the server running?");
});

test("check says whether audio tags are performed", () => {
  expect(describeVoice(VOICE)).toBe("Voice: eleven_v4 on elevenlabs, performs [audio tags]");
  expect(describeVoice({ baseUrl: "http://localhost:8880/v1", model: "kokoro", voice: "af_heart" })).toStartWith("Voice: kokoro on http://localhost:8880/v1, takes [audio tags] out");
});

test("clips nobody used for a month are deleted", async () => {
  const cache = join(dir, "prune");
  await Bun.write(join(cache, "old.mp3"), "x");
  await Bun.write(join(cache, "new.mp3"), "x");
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await utimes(join(cache, "old.mp3"), old, old);
  await pruneVoiceCache(cache);
  expect(await readdir(cache)).toEqual(["new.mp3"]);
});

test("an action lands as its caption is said, the next caption waits for the voice, and the video gets the voice", async () => {
  const file = join(dir, "clip.mp3");
  await Bun.write(file, tone);
  const said: string[] = [];
  const speak = async (text: string): Promise<Clip> => (said.push(text), { file, ms: 1500 });
  const script: Script = resolveScript(
    {
      url: "./page.html",
      viewport: { width: 320, height: 200 },
      deviceScaleFactor: 1,
      output: { width: 320, height: 180, fps: 10 },
      voice: VOICE,
      steps: [
        { action: "click", target: "#b", caption: "[warmly] Hi" },
        { action: "wait", ms: 100, caption: "Done" },
      ],
    },
    join(dir, "demo.yaml"),
  ).script;
  const rec = await record(script, join(dir, "work"), speak);
  expect([...new Set(said)]).toEqual(["[warmly] Hi", "Done"]);
  const [step, next] = rec.steps;
  expect(rec.voice).toEqual([
    { step: 0, file, start: step!.start },
    { step: 1, file, start: next!.start },
  ]);
  // The click comes while the voice is still speaking, not after it, and the next caption only after it has finished.
  expect(step!.actionAt! - step!.start).toBeGreaterThanOrEqual(700);
  expect(step!.actionAt! - step!.start).toBeLessThan(1500);
  expect(next!.start - step!.start).toBeGreaterThanOrEqual(2000);

  const out = join(dir, "out.mp4");
  await render(script, rec, join(dir, "work"), out);
  const ffmpeg = await ensureTool("ffmpeg");
  const log = Bun.spawnSync([ffmpeg, "-hide_banner", "-i", out, "-map", "0:a", "-f", "null", "-"]).stderr.toString();
  expect(log).toContain("Audio: aac");
  // An AAC frame lasts 1024 samples (one may be a sample short, from rounding where clips meet). With broken
  // timestamps they last one tick, and players lose the sound after a seek.
  const frames = Bun.spawnSync([ffmpeg, "-v", "error", "-i", out, "-map", "0:a", "-c", "copy", "-f", "framecrc", "-"]).stdout.toString().split("\n").filter((l) => /^\d/.test(l));
  expect(frames.slice(0, -1).filter((l) => Number(l.split(",")[3]) < 1000)).toEqual([]);
  // The sound lasts as long as the video, silent after the last clip.
  const samples = Bun.spawnSync([ffmpeg, "-v", "error", "-i", out, "-map", "0:a", "-f", "s16le", "-ac", "1", "-ar", "8000", "-"]).stdout.length / 2;
  expect(Math.abs(samples / 8 - rec.duration)).toBeLessThan(150);
  // Seeking into the clip still finds the voice.
  const seeked = Bun.spawnSync([ffmpeg, "-v", "error", "-ss", "1", "-i", out, "-map", "0:a", "-f", "s16le", "-"]).stdout;
  expect(seeked.length).toBeGreaterThan(0);
}, 60_000);

test("a caption with a saved value is read when its step comes, without the wait showing in the video", async () => {
  const file = join(dir, "clip.mp3");
  await Bun.write(file, tone);
  const slow = async (): Promise<Clip> => (await Bun.sleep(1000), { file, ms: 300 });
  const script: Script = resolveScript(
    {
      url: "./page.html",
      viewport: { width: 320, height: 200 },
      deviceScaleFactor: 1,
      voice: VOICE,
      steps: [
        { action: "save", as: "name", target: "#b" },
        { action: "wait", ms: 100, caption: "Now ${name}" },
      ],
    },
    join(dir, "vars.yaml"),
  ).script;
  const rec = await record(script, join(dir, "vars-work"), slow);
  const [save, said] = rec.steps;
  expect(rec.voice?.map((v) => v.step)).toEqual([1]);
  expect(said!.start - save!.end).toBeLessThan(200);
}, 60_000);

test("audio tags are said but never shown", () => {
  expect(withoutTags("[warmly] Add it [short pause] to the list. [laughs]")).toBe("Add it to the list.");
  expect(withoutTags("Saved [sighs].")).toBe("Saved.");
});

test("without a voice, brackets are just text; with one, a caption of only tags shows nothing", () => {
  const silent = makeScript({ steps: [{ action: "wait", ms: 1, caption: "Press [Enter] to save" }, { action: "wait", ms: 1, caption: "[laughs]" }] });
  const rec = makeRecording(silent, { steps: [{ index: 0, screen: "main", start: 0, end: 1 }, { index: 1, screen: "main", start: 1, end: 2 }] });
  expect(shownCaption(silent, "Press [Enter]")).toBe("Press [Enter]");
  expect(buildCaptions(silent, rec).map((c) => c.text)).toEqual(["Press [Enter] to save", "[laughs]"]);
  expect(buildCaptions({ ...silent, voice: VOICE }, rec).map((c) => c.text)).toEqual(["Press to save"]);
});

test("with a voice, changing a caption's words needs a new recording", () => {
  const base: Script = { url: "x", steps: [{ action: "wait", ms: 1, caption: "One two" }] };
  const reworded: Script = { url: "x", steps: [{ action: "wait", ms: 1, caption: "Two one" }] };
  expect(recordingKey(base)).toBe(recordingKey(reworded));
  expect(recordingKey({ ...base, voice: VOICE })).not.toBe(recordingKey({ ...reworded, voice: VOICE }));
});
