import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { SHOWEM_HOME } from "./deps.ts";

const PROJECT_DIR = ".showem";
export const CONFIG_FILE = "config.yaml";
export const GLOBAL_CONFIG = join(SHOWEM_HOME, CONFIG_FILE);
/** Frames, recordings and render parts. The system clears its temp folder on its own. */
export const BUILD_ROOT = join(tmpdir(), "showem");

const CONFIG_TEMPLATE = `# Settings for every showem script in this project. A script's own fields win over these.
# Paths are relative to this folder. \`showem docs\` describes each field.
# Secrets go in .showem/.env (git ignores it), and the config names them: \${{ env.NAME }}.

# style:
#   background: backgrounds/brand.jpg
#   padding: 0.08
# output:
#   width: 2560
#   height: 1440
# voice:
#   provider: elevenlabs
#   voice: JBFqnCBsd6RMkjVDRZzb
#   api-key: \${{ env.ELEVENLABS_API_KEY }}
`;

/** The nearest `.showem` folder from `dir` up, other than the one in the home folder. */
export function findProject(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    const candidate = join(d, PROJECT_DIR);
    if (candidate !== SHOWEM_HOME && existsSync(candidate)) return candidate;
    if (dirname(d) === d) return undefined;
  }
}

/** Where the recording and render parts for a video go, named after the video's full path. */
export const buildDir = (outPath: string) => join(BUILD_ROOT, `${basename(outPath)}-${Bun.hash(outPath).toString(36)}`);

/** Creates `.showem/` in `dir` with a config to fill in, and keeps its videos and env files out of git, except an `.env.example`. */
export async function initProject(dir: string) {
  const root = join(dir, PROJECT_DIR);
  if (root === SHOWEM_HOME) throw new Error(`${SHOWEM_HOME} holds showem's browser and ffmpeg. Run init in a project folder.`);
  const config = join(root, CONFIG_FILE);
  if (existsSync(config)) throw new Error(`${join(PROJECT_DIR, CONFIG_FILE)} already exists`);
  await Bun.write(config, CONFIG_TEMPLATE);
  const gitignore = join(root, ".gitignore");
  if (!existsSync(gitignore)) await Bun.write(gitignore, "videos/\n.env*\n!.env.example\n");
  return root;
}
