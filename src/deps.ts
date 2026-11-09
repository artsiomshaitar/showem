import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { expectSuccess } from "./ffmpeg.ts";

/** Where showem keeps the browser and ffmpeg it downloads on first use. */
export const SHOWEM_HOME = join(homedir(), ".showem");

interface Tool {
  title: string;
  version: string;
  /** Path of the executable inside the unpacked archive. */
  bin: string;
  url: string;
  sha256: string;
  mb: number;
}

/** Matches the `chromium-headless-shell` browserVersion in playwright-core's browsers.json. */
export const CHROMIUM_VERSION = "156.0.8078.4";
const FFMPEG_VERSION = "9.0.2";

const chromium = (arch: "arm64" | "x64", sha256: string, mb: number): Tool => ({
  title: "Chromium",
  version: CHROMIUM_VERSION,
  bin: `chrome-headless-shell-mac-${arch}/chrome-headless-shell`,
  url: `https://storage.googleapis.com/chrome-for-testing-public/${CHROMIUM_VERSION}/mac-${arch}/chrome-headless-shell-mac-${arch}.zip`,
  sha256,
  mb,
});

const ffmpeg = (arch: "arm64" | "amd64", build: string, sha256: string, mb: number): Tool => ({
  title: "ffmpeg",
  version: FFMPEG_VERSION,
  bin: "ffmpeg",
  url: `https://ffmpeg.martin-riedl.de/download/macos/${arch}/${build}_${FFMPEG_VERSION}/ffmpeg.zip`,
  sha256,
  mb,
});

const TOOLS = {
  arm64: {
    chromium: chromium("arm64", "94e4337b70cbc5638f0935fbc46b9f242bc7416f657e3fbe924baf348404b53d", 99),
    ffmpeg: ffmpeg("arm64", "1789931890", "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924", 27),
  },
  x64: {
    chromium: chromium("x64", "8a9e4a32ba5b1a796f8b16d01896e355cf6662544d9743296394fd999d782331", 104),
    ffmpeg: ffmpeg("amd64", "1789931006", "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4", 32),
  },
};

type ToolName = keyof (typeof TOOLS)["arm64"];

function toolFor(name: ToolName): Tool {
  if (process.platform !== "darwin" || (process.arch !== "arm64" && process.arch !== "x64")) {
    throw new Error(`showem runs on macOS only for now (this is ${process.platform}-${process.arch}).`);
  }
  return TOOLS[process.arch][name];
}

const dirOf = (name: ToolName, tool: Tool) => join(SHOWEM_HOME, `${name}-${tool.version}-${process.arch}`);

/** Where the tool's executable is once installed. Render workers use this after the main process has installed it. */
export function toolPath(name: ToolName) {
  const tool = toolFor(name);
  return join(dirOf(name, tool), tool.bin);
}

const installing = new Map<ToolName, Promise<string>>();

/** Downloads the tool into ~/.showem the first time it's needed, checks its checksum, and returns the executable's path. */
export function ensureTool(name: ToolName): Promise<string> {
  let pending = installing.get(name);
  if (!pending) {
    pending = install(name);
    installing.set(name, pending);
    pending.catch(() => installing.delete(name));
  }
  return pending;
}

async function install(name: ToolName) {
  const tool = toolFor(name);
  const path = toolPath(name);
  if (await Bun.file(path).exists()) return path;

  console.error(`Downloading ${tool.title} ${tool.version} (${tool.mb} MB) into ${SHOWEM_HOME}. This happens once.`);
  const res = await fetch(tool.url);
  if (!res.ok) throw new Error(`Couldn't download ${tool.title} from ${tool.url}: HTTP ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  const sha256 = new Bun.CryptoHasher("sha256").update(data).digest("hex");
  if (sha256 !== tool.sha256) throw new Error(`${tool.title} download from ${tool.url} doesn't match its checksum. Try again.`);

  await mkdir(SHOWEM_HOME, { recursive: true });
  const tmp = await mkdtemp(join(SHOWEM_HOME, `.${name}-`));
  try {
    const zip = join(tmp, "download.zip");
    await Bun.write(zip, data);
    await expectSuccess(Bun.spawn(["ditto", "-x", "-k", zip, join(tmp, "out")]), `Unpacking ${tool.title}`);
    // Another showem process may have finished the same download first.
    if (!(await Bun.file(path).exists())) await rename(join(tmp, "out"), dirOf(name, tool));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return path;
}
