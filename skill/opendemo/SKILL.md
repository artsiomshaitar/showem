---
name: opendemo
description: Record a polished demo video of a web app without touching the user's screen. Use when the user asks for a demo, demo video, screen recording, product video, or a video showing a feature or a pull request. Runs a headless browser, then renders zooms, a smooth cursor, captions, motion blur and a background into an MP4.
---

# Make a demo video with OpenDemo

OpenDemo runs a step script in a headless browser and renders the video. The user's screen and mouse are never used, so they can keep working.

## 1. Plan

- One message per video. Decide what the viewer should remember.
- 3 to 6 steps, 10 to 40 seconds. Each important step gets a caption of 8 words or fewer.
- Make sure the app is running and seeded with realistic data. No secrets or personal data on screen.

## 2. Write the script

Save it as `<name>.demo.json`. Relative paths resolve from the script's folder.

```json
{
  "url": "http://localhost:3000",
  "viewport": { "width": 1440, "height": 900 },
  "output": { "path": "demo.mp4", "width": 2560, "height": 1440, "fps": 60 },
  "style": {
    "background": "/path/to/wallpaper.png",
    "padding": 0.08,
    "radius": 0.018,
    "shadow": 0.6,
    "motionBlur": 0.5,
    "cursor": { "size": 1, "travelMs": 800 },
    "captions": { "fontSize": 32 }
  },
  "steps": [
    { "action": "pause", "ms": 1200, "caption": "The dashboard at a glance" },
    { "action": "click", "target": "text=New project", "zoom": true, "caption": "Create a project" },
    { "action": "type", "target": "#name", "text": "Launch plan", "zoom": 1.6 },
    { "action": "press", "key": "Enter" },
    { "action": "waitFor", "target": "text=Launch plan" },
    { "action": "scroll", "y": 400, "caption": "Everything in one place" },
    { "action": "pause", "ms": 1000 }
  ]
}
```

Actions: `goto` (url), `click`, `hover`, `type` (target, text, optional delayMs), `press` (key), `scroll` (y in px), `waitFor` (target), `pause` (ms). Every step can have a `caption`; it stays on screen until the next caption.

- `target` is a Playwright selector: `text=Save`, `#id`, `button:has-text("Save")`, `[data-testid=x]`.
- `zoom` (on click, hover, type): `true` (1.8×), a number for the scale, or `{ "scale": 2, "holdMs": 600, "include": ["#list li:last-child"] }`. `include` lists other elements to keep in view with the target, usually what the action changes (a new row, a toast, a result). The camera frames all of them, measured once the step finishes, and zooms out below `scale` if they would not fit. Zoom on the steps that matter, not on every step. Close zooms are joined into one smooth pan. On a zoomed `type` step the camera follows the last typed word and stays inside the input.
- `motionBlur`: 0 (off) to 1 (strong). It only applies while the camera or cursor moves.
- Start with a `pause` of about 1 s so viewers see the starting state, and end with one too.

## 3. Run it

```sh
opendemo run demo.json      # record + render, prints the MP4 path
opendemo render demo.json   # re-render after changing only "style" or captions
```

Run it in the background if it is long. The recording is kept in `<output>.opendemo/`.

## 4. Check before handing over

Extract a few frames and look at them:

```sh
ffmpeg -v error -i demo.mp4 -vf "fps=1/2,scale=640:-1,tile=3x2" -frames:v 1 contact.jpg
```

Check that every step happened, zooms land on the right element, and captions are readable. If a step failed (the run errors with the selector), fix the selector and run again.
