# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

showem turns a YAML (or JSON) step script into a demo video: it runs the script in headless Chromium, then draws zooms, cursor, captions and device frames on top. Bun + TypeScript, no build step.

## Commands

```sh
bun test --parallel              # all tests (~35s, some launch Chromium and ffmpeg)
bun test test/plan.test.ts       # one file
bun run typecheck
bun src/cli.ts check <script.yaml>   # check a script without running it
bun src/cli.ts run <script.yaml>     # record + render (`-` reads the script from stdin)
bun src/cli.ts render <script.yaml>  # re-render the last recording
bun scripts/build.ts                 # release binaries into dist/ (run `bun install --os=darwin --cpu='*'` first)
```

After every code change, run `bun test` and `bun run typecheck`, and fix anything that fails before you finish.

The team example needs its server: `bun examples/team/server.ts &` (port 4321). Stop it when done.

## How it works

1. **Record** (`record.ts`): runs the steps in the browser and saves frames plus a log of what happened and when (`recording.json`).
2. **Plan** (`plan.ts`, `camera.ts`): works out camera, cursor and captions from that log.
3. **Render** (`render.ts`, `frames.ts`, `draw.ts`): draws every frame and encodes it with ffmpeg.

Main rule: `render` only accepts a recording if the script still matches it (`recordingKey` in `script.ts`). Anything that changes what happens in the browser or its timing needs a re-record; anything that only changes the look (zoom scale, style, transition type) should work with a re-render. Decide which side a new option is on.

## Docs

Update `skill/showem/SKILL.md` (the script format reference) with any script change. Keep it app-agnostic.

The script format lives in `format.ts` (fields, actions with their docs and examples, parsing, line numbers; `showem docs` prints them via `docs.ts`) and `script.ts` (`checkScript`, checks that need the whole script). After changing it, run `bun src/cli.ts schema > showem.schema.json`.

## Releases

Chromium and ffmpeg are pinned in `deps.ts` (URL and sha256 per Mac CPU) and downloaded into `~/.showem` on first use. When playwright-core is upgraded, update `CHROMIUM_VERSION` and the Chromium checksums to match its `browsers.json` (`test/deps.test.ts` fails until you do).

The binary is built with `bun build --compile`, so code can't rely on source files on disk at runtime (see the render worker in `render.ts`).

To release: bump `version` in `package.json`, then push a `vX.Y.Z` tag. The release workflow builds both Mac binaries, publishes them to GitHub Releases and updates the formula in `artsiomshaitar/homebrew-tap`. `install.sh` installs the latest release.
