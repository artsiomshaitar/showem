import { mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { ensureTool, SHOWEM_HOME } from "./deps.ts";
import { expectSuccess } from "./ffmpeg.ts";
import { withoutTags } from "./script.ts";
import type { Script } from "./types.ts";

const VOICE_CACHE = join(SHOWEM_HOME, "voice");
const DEFAULT_VOICE_MODEL = "eleven_v4";
/** Clips not used for this long are deleted. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export interface Clip {
  file: string;
  ms: number;
}

/** The captions said before and after this one, so each sentence sounds like part of one narration, not a fresh start. */
export interface Around {
  previous?: string;
  next?: string;
}

export type Speak = (text: string, around?: Around) => Promise<Clip>;

type Voice = NonNullable<Script["voice"]>;

const API_ROOTS = { elevenlabs: "https://api.elevenlabs.io/v1", openai: "https://api.openai.com/v1", openrouter: "https://openrouter.ai/api/v1" };

const modelOf = (voice: Voice) => voice.model ?? DEFAULT_VOICE_MODEL;

/** Whether the model performs `[excited]`-style audio tags. If not, they're taken out, or it would say them aloud. */
const performsTags = (voice: Voice) => voice.audioTags ?? (voice.provider === "elevenlabs" && /^eleven_v[34]/.test(modelOf(voice)));

/** One line for the terminal: which voice reads the captions, and what happens to audio tags. */
export function describeVoice(voice: Voice) {
  const tags = performsTags(voice) ? "performs [audio tags]" : "takes [audio tags] out of what it says (set audio-tags: true if this model performs them)";
  return `Voice: ${modelOf(voice)} on ${voice.provider ?? voice.baseUrl}, ${tags}`;
}

interface SpeechRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * Reads captions aloud. Each clip is kept in the cache by everything that went into it, so a caption is only paid for once.
 * The same request asked for twice shares one call. `api` replaces the service's API root, for testing.
 */
export function speaker(voice: Voice, apiKey: string | undefined, cacheDir = VOICE_CACHE, api?: string): Speak {
  const root = api ?? voice.baseUrl ?? API_ROOTS[voice.provider!];
  const model = modelOf(voice);
  const spoken = (text: string | undefined) => (text === undefined || performsTags(voice) ? text : withoutTags(text));
  const clips = new Map<string, Promise<Clip>>();
  return (text, around = {}) => {
    // ElevenLabs takes the captions around this one too, so the sentences flow as one narration.
    const request: SpeechRequest =
      voice.provider === "elevenlabs"
        ? {
            url: `${root}/text-to-speech/${encodeURIComponent(voice.voice)}?output_format=mp3_44100_128`,
            headers: { "xi-api-key": apiKey! },
            body: { text: spoken(text), model_id: model, previous_text: spoken(around.previous), next_text: spoken(around.next), ...voice.extra },
          }
        : {
            url: `${root}/audio/speech`,
            headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
            body: { model, voice: voice.voice, input: spoken(text), response_format: "mp3", instructions: voice.instructions, ...voice.extra },
          };
    const key = JSON.stringify(voice.provider === "elevenlabs" ? [voice.voice, request.body] : [request.url, request.body]);
    let clip = clips.get(key);
    if (!clip) {
      clip = fetchClip(request, key, cacheDir, `${voice.provider ?? voice.baseUrl} couldn't read "${spoken(text)}"`);
      clips.set(key, clip);
    }
    return clip;
  };
}

async function fetchClip(request: SpeechRequest, key: string, cacheDir: string, failed: string): Promise<Clip> {
  const file = join(cacheDir, `${Bun.hash(key).toString(36)}.mp3`);
  if (await Bun.file(file).exists()) {
    const now = new Date();
    await utimes(file, now, now);
  } else {
    const res = await fetch(request.url, { method: "POST", headers: { ...request.headers, "content-type": "application/json" }, body: JSON.stringify(request.body) }).catch((error: Error) => {
      throw new Error(`${failed}: ${error.message}. Is the server running?`);
    });
    if (!res.ok) throw new Error(`${failed}: ${res.status} ${await res.text()}`);
    await mkdir(cacheDir, { recursive: true });
    await Bun.write(file, await res.arrayBuffer());
  }
  return { file, ms: await audioMs(file) };
}

/** Length of an audio file, from decoding it: 8 kHz mono 16-bit is 16 bytes a millisecond. */
async function audioMs(file: string) {
  const proc = Bun.spawn([await ensureTool("ffmpeg"), "-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", "8000", "-"], { stdout: "pipe", stderr: "inherit" });
  const bytes = (await new Response(proc.stdout).arrayBuffer()).byteLength;
  await expectSuccess(proc, "ffmpeg");
  return Math.round(bytes / 16);
}

/** Deletes clips no recording has used for a month. */
export async function pruneVoiceCache(cacheDir = VOICE_CACHE) {
  const names = await readdir(cacheDir).catch(() => []);
  const now = Date.now();
  for (const name of names) {
    const file = join(cacheDir, name);
    if (now - (await stat(file)).mtimeMs > KEEP_MS) await rm(file, { force: true });
  }
}
