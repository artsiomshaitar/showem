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
opendemo check examples/todo.demo.yaml    # check the script, without running anything
opendemo run examples/todo.demo.yaml      # record + render
opendemo record examples/todo.demo.yaml   # only record
opendemo render examples/todo.demo.yaml   # only render, from the last recording
```

Scripts are YAML or JSON. Pass `-` instead of a path to read the script from stdin, so an agent can send it without saving a file. `--out` sets where the video goes, instead of the script's `output.path`:

```sh
opendemo run - --out /tmp/demos/new-project.mp4 <<'EOF'
url: http://localhost:3000
steps:
  - action: click
    target: text=New project
    zoom: true
    caption: Create a project
EOF
```

`examples/team.demo.yaml` shows two screens: an admin page in a browser and a member app on a phone, with live updates between them. The admin logs in (`admin@northwind.test` / `northwind`) while recording is paused, so the video starts on the admin page. It needs the sample server running first:

```sh
bun examples/team/server.ts &
opendemo run examples/team.demo.yaml
```

`opendemo docs` prints the script format, and `opendemo docs <action>` one action's fields with an example. [`skill/opendemo/SKILL.md`](skill/opendemo/SKILL.md) is the guide for agents. [`opendemo.schema.json`](opendemo.schema.json) describes it as JSON Schema, for autocomplete and inline errors in editors: add `# yaml-language-server: $schema=<path to opendemo.schema.json>` at the top of a YAML script. After changing the format, regenerate it with `bun src/cli.ts schema > opendemo.schema.json`. To give it to Claude Code, copy or link `skill/opendemo` into `~/.claude/skills/`.

## How it works

1. **Record** (`src/record.ts`): headless Chromium at 3× scale, one isolated browser context per screen, all recording for the whole run. Frames come from the DevTools screencast with their real timestamps. The steps run with a real mouse moving along eased curves (`src/motion.ts`), and every cursor position, click, caret position (`src/caret.ts`), navigation and step time is saved to `recording.json`. While recording is paused, steps run at full speed and the clock stops, so the paused stretch never makes it into the timeline.
2. **Plan** (`src/plan.ts`, `src/camera.ts`): zoom shots from the steps marked `zoom`, joined into pans when close and split at page navigations, followed by a critically damped spring. Cursor path and caption timing come from the recording.
3. **Render** (`src/render.ts`, `src/frames.ts`, `src/draw.ts`): the video is split into ranges, and each range is drawn by its own process with Skia (`@napi-rs/canvas`): background, browser window or phone frame, page, cursor or taps, and captions, with a fade or slide where the script switches screens, also when it resumes recording on a different screen, with the camera applied to the whole frame. Motion blur blends sub-frames while something moves. Each process encodes its part with ffmpeg (`src/ffmpeg.ts`), and the parts are joined without re-encoding.

`opendemo render` only works while the steps match the recording. Changing zoom scale, style or a caption's wording (same number of words) is fine; changing screens, actions, targets, `keep-in-view` or a caption's length needs `opendemo run`, because the recording waits for each caption to be read.

## Development

```sh
bun test          # unit tests, plus browser and ffmpeg tests
bun run typecheck
```
