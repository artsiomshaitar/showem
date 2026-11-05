# OpenDemo

Demo videos for AI agents. An agent writes a step script, OpenDemo plays it in a headless browser and renders a polished MP4 with zooms, a smooth cursor, captions, motion blur and a background. Nothing runs on your screen.

## Setup

Needs [Bun](https://bun.sh) and `ffmpeg` on the PATH.

```sh
bun install
bunx playwright-core install chromium-headless-shell
bun link   # optional: makes `opendemo` available globally
```

## Usage

```sh
opendemo run examples/todo.demo.json      # record + render
opendemo record examples/todo.demo.json   # only record
opendemo render examples/todo.demo.json   # only render, from the last recording
```

See [`skill/opendemo/SKILL.md`](skill/opendemo/SKILL.md) for the script format. To give it to Claude Code, copy or link `skill/opendemo` into `~/.claude/skills/`.

## How it works

1. **Record** (`src/record.ts`): headless Chromium at 3× scale. Frames come from the DevTools screencast with their real timestamps. The steps run with a real mouse moving along eased curves (`src/motion.ts`), and every cursor position, click, caret position (`src/caret.ts`), navigation and step time is saved to `recording.json`.
2. **Plan** (`src/plan.ts`, `src/camera.ts`): zoom shots from the steps marked `zoom`, joined into pans when close and split at page navigations, followed by a critically damped spring. Cursor path and caption timing come from the recording.
3. **Render** (`src/render.ts`, `src/frames.ts`, `src/draw.ts`): the video is split into ranges, and each range is drawn by its own process with Skia (`@napi-rs/canvas`): background, window with toolbar, page, cursor and captions, with the camera applied to the whole frame. Motion blur blends sub-frames while something moves. Each process encodes its part with ffmpeg (`src/ffmpeg.ts`), and the parts are joined without re-encoding.

`opendemo render` only works while the steps match the recording. Changing captions, zoom scale or style is fine; changing actions, targets or `zoom.include` needs `opendemo run`.

## Development

```sh
bun test          # unit tests, plus browser and ffmpeg tests
bun run typecheck
```
