# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

OpenDemo turns a JSON step script into a demo video: it runs the script in headless Chromium, then draws zooms, cursor, captions and device frames on top. Bun + TypeScript, no build step.

## Commands

```sh
bun test                         # all tests (~25s, some launch Chromium and ffmpeg)
bun test test/plan.test.ts       # one file
bun run typecheck
bun src/cli.ts run <script.json>     # record + render
bun src/cli.ts render <script.json>  # re-render the last recording
```

After every code change, run `bun test` and `bun run typecheck`, and fix anything that fails before you finish.

The team example needs its server: `bun examples/team/server.ts &` (port 4321). Stop it when done.

## How it works

1. **Record** (`record.ts`): runs the steps in the browser and saves frames plus a log of what happened and when (`recording.json`).
2. **Plan** (`plan.ts`, `camera.ts`): works out camera, cursor and captions from that log.
3. **Render** (`render.ts`, `frames.ts`, `draw.ts`): draws every frame and encodes it with ffmpeg.

Main rule: `render` only accepts a recording if the script still matches it (`recordingKey` in `script.ts`). Anything that changes what happens in the browser or its timing needs a re-record; anything that only changes the look (zoom scale, style, transition type) should work with a re-render. Decide which side a new option is on.

## Docs

Update `skill/opendemo/SKILL.md` (the script format reference) with any script change. Keep it app-agnostic.
