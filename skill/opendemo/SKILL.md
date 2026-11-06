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
    { "action": "wait", "ms": 1200, "caption": "The dashboard at a glance" },
    { "action": "click", "target": "text=New project", "zoom": true, "caption": "Create a project" },
    { "action": "type", "target": "#name", "text": "Launch plan", "zoom": 1.6 },
    { "action": "press", "key": "Enter" },
    { "action": "wait-for", "target": "text=Launch plan" },
    { "action": "scroll", "y": 400, "caption": "Everything in one place" },
    { "action": "wait", "ms": 1000 }
  ]
}
```

Actions: `goto` (url), `click`, `hover`, `type` (target, text, optional delayMs), `press` (key), `scroll` (y in px), `wait-for` (target), `wait` (ms), `switch` (screen), `save`, `pause-recording` and `resume-recording` (see below). Every step can have a `caption`; it stays on screen until the next caption. The caption shows first and the step waits until it can be read, so viewers read it and then watch what happens (on a `switch`, the caption shows briefly before the screen changes, and the rest of the reading time comes after).

- `target` is a Playwright selector: `text=Save`, `#id`, `button:has-text("Save")`, `[data-testid=x]`.
- `zoom` (on click, hover, type): `true` (1.8×), a number for the scale, or `{ "scale": 2, "holdMs": 600, "include": ["#list li:last-child"] }`. `include` lists other elements to keep in view with the target, usually what the action changes (a new row, a toast, a result). The camera frames all of them, measured once the step finishes, and zooms out below `scale` if they would not fit. Zoom on the steps that matter, not on every step. Close zooms are joined into one smooth pan. On a zoomed `type` step the camera follows the last typed word and stays inside the input.
- `motionBlur`: 0 (off) to 1 (strong). It only applies while the camera or cursor moves.
- Start with a `wait` of about 1 s so viewers see the starting state, and end with one too.

### More than one screen

When a feature has two sides (one person acts, another sees the result), declare `screens` instead of `url`. Each screen is its own browser page with its own cookies, so each can be signed in as a different user. All screens run for the whole recording, so changes made on one screen already show on the other when the video cuts to it.

```json
{
  "screens": {
    "desk":  { "url": "http://localhost:3000/orders", "frame": "browser-safari" },
    "phone": { "url": "http://localhost:4000/", "frame": "mobile-iphone" }
  },
  "steps": [
    { "action": "click", "target": "text=New order", "caption": "Create an order" },
    { "action": "save", "as": "link", "target": "#order-link", "attribute": "href" },
    { "action": "switch", "screen": "phone", "caption": "Open it on the phone" },
    { "action": "goto", "url": "${link}" }
  ]
}
```

- The first screen is on camera at the start. `{ "action": "switch", "screen": "phone" }` moves to another screen; the steps after it run there until the next `switch`. A switch keeps a short pause before and after, so there is no need to add `wait` steps around it.
- `transition` on a switch: `fade` (default) or `slide`. A slide moves the windows sideways: to the left when going to a screen listed later in `screens`, to the right when going back. Changing it only needs `opendemo render`.
- `frame`: `browser-safari` (default), `browser-chrome`, `mobile-iphone` or `none`. A browser frame uses `viewport` (per screen, or the top-level one). A phone has its own screen size, so don't set `viewport` on it. Phones show taps instead of a cursor.
- Each screen keeps its scroll and cursor position. The camera is zoomed out right after every switch.

### Values found during the recording

Some values only exist once the recording runs (a link, an ID the demo just created). `save` reads one and stores it under a name; any later step can use it as `${name}` in any text: URLs, typed text, targets, captions.

```json
{ "action": "save", "as": "link", "target": "#share", "attribute": "href" }
{ "action": "save", "as": "id",   "target": ".record-id" }
{ "action": "save", "as": "page", "from": "url" }
{ "action": "save", "as": "copied", "from": "clipboard" }
```

That is an element's attribute (`href` comes back as a full URL), an element's text, the current page URL, or the clipboard (after a step that copies). `save` takes no time in the video. The run stops with an error if a value is used before it is saved or the element doesn't exist.

### Steps that run but aren't recorded

Put preparation nobody needs to watch (logging in, opening the right page, closing a banner) between `pause-recording` and `resume-recording`, like the pause button on a screen recorder:

```json
{ "action": "pause-recording" },
{ "action": "type",  "target": "#email",    "text": "user@example.com" },
{ "action": "type",  "target": "#password", "text": "demo-password" },
{ "action": "click", "target": "#submit" },
{ "action": "wait-for", "target": "text=Dashboard" },
{ "action": "resume-recording" },
```

- Paused at the start: the video begins at the first `resume-recording`, on the page the setup left behind.
- Paused in the middle, resumed on the same screen: that stretch is cut out and the video carries on. Whatever the paused steps changed on that page just appears.
- Paused on one screen, resumed on another: a `switch` while paused prepares the other screen off camera. On resume the video moves straight to it, like a visible switch, using the `transition` and `caption` of the last paused `switch`. Screens visited in between never show.
- Paused steps run at full speed: no cursor travel, no typing delay. End the paused part with a `wait-for` on something the next visible step needs, so the video resumes on a ready page.
- Captions, zoom and transitions on other paused steps are ignored, with a warning. Every `pause-recording` needs a `resume-recording` after it. `save` and `${name}` work as usual.

```json
{ "action": "pause-recording" },
{ "action": "switch", "screen": "phone", "transition": "slide", "caption": "Sam opens it on the phone" },
{ "action": "goto", "url": "${link}" },
{ "action": "wait-for", "target": "text=Welcome" },
{ "action": "resume-recording" },
```

## 3. Run it

```sh
opendemo run demo.json      # record + render, prints the MP4 path
opendemo render demo.json   # re-render after changing only "style" or a caption's wording (not screens, steps or caption length)
```

Run it in the background if it is long. The recording is kept in `<output>.opendemo/`.

## 4. Check before handing over

Extract a few frames and look at them:

```sh
ffmpeg -v error -i demo.mp4 -vf "fps=1/2,scale=640:-1,tile=3x2" -frames:v 1 contact.jpg
```

Check that every step happened, zooms land on the right element, and captions are readable. If a step failed (the run errors with the selector), fix the selector and run again.
