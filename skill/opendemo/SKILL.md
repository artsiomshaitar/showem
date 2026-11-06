---
name: opendemo
description: Record a polished demo video of a web app without touching the user's screen. Use when the user asks for a demo, demo video, screen recording, product video, or a video showing a feature or a pull request. Runs a headless browser, then renders zooms, a smooth cursor, captions, motion blur and a background into an MP4.
---

# Make a demo video with OpenDemo

OpenDemo runs a step script in a headless browser and renders the video. The user's screen and mouse are never used, so they can keep working.

## 1. Understand the app first

If you can read the app's code, read how the flow works before you write any steps:

- What each action changes, and what appears after it (a new row, a dialog, a different page).
- Which values only exist while the script runs (an ID or link the flow creates). Read those with `save`. Never make them up or write them into the script.
- Take selectors and URLs from the code. Never guess them.

Make sure the app is running and has realistic data. No secrets or personal data on screen.

## 2. Plan

- One message per video. Decide what the viewer should remember.
- Do what the user asked. If they don't want to see a part, it goes between `pause-recording` and `resume-recording`. If they ask for a quick video, keep it short.
- 3 to 6 visible steps, 10 to 40 seconds. Each important step gets a caption of 8 words or fewer.

## 3. Write the script

Scripts are YAML (JSON works too, with the same fields). Pass the script to OpenDemo on stdin with `-`. Don't save it to a file unless the user asks for one:

```sh
opendemo check - <<'EOF'
url: http://localhost:3000
steps:
  - action: wait
    ms: 1200
    caption: The dashboard at a glance

  - action: click
    target: text=New project
    zoom: true
    caption: Create a project
EOF
```

Always quote the marker (`<<'EOF'`), or the shell replaces `${name}` before OpenDemo sees it. Relative paths and URLs resolve from the current folder (from the script's folder when it's a file).

A full script:

```yaml
url: http://localhost:3000
viewport:
  width: 1440
  height: 900
zoom: 1.8                 # the scale of `zoom: true` steps
zoom-hold-ms: 300         # how long the camera stays zoomed after a step
output:
  path: demo.mp4
  width: 2560
  height: 1440
  fps: 60
style:
  background: /path/to/wallpaper.png
  padding: 0.08
  radius: 0.018
  shadow: 0.6
  motion-blur: 0.5        # 0 (off) to 1 (strong), only while the camera or cursor moves
  cursor:
    size: 1
    travel-ms: 800
  captions:
    font-size: 32

steps:
  - action: wait
    ms: 1200
    caption: The dashboard at a glance

  - action: click
    target: text=New project
    zoom: true
    caption: Create a project

  - action: type
    target: "#name"
    text: Launch plan
    zoom: 1.6

  - action: press
    key: Enter

  - action: wait-for
    target: text=Launch plan

  - action: scroll
    y: 400
    caption: Everything in one place

  - action: wait
    ms: 1000
```

Each step is a list item that starts with `action:`. Its other fields go on the lines below, lined up with `action:`. All names are kebab-case. Write one field per line, not `{ ... }` on one line, and put a blank line between steps.

The actions are `goto`, `click`, `hover`, `type`, `press`, `scroll`, `wait-for`, `wait`, `switch`, `save`, `pause-recording` and `resume-recording`. For the exact fields:

```sh
opendemo docs           # every top-level field, how steps work, and the list of actions
opendemo docs click     # one action: what it does, its fields, and an example
```

Look up an action with `opendemo docs <action>` before using a field you're not sure about. Don't guess field names.

Every step except `pause-recording` and `resume-recording` can have a `caption`. It stays on screen until the next caption. The caption shows first and the step waits until it can be read, so viewers read it and then watch what happens.

- `target` is a Playwright selector: `text=Save`, `#id`, `button:has-text("Save")`, `[data-testid=x]`. Put quotes around any selector that starts with `#`, or YAML reads it as a comment.
- `zoom` (on click, hover, type): `true` uses the script's `zoom` scale, a number zooms to that scale. Zoom on the steps that matter, not on every step. Close zooms are joined into one smooth pan. On a zoomed `type` step the camera follows the last typed word.
- `keep-in-view`: a list of other elements to keep in frame with the target while zoomed, usually what the step changes (a new row, a toast). The camera zooms out below the scale if they don't fit.
- Start with a `wait` of about 1 s so viewers see the starting state, and end with one too.
- Use `#` comments to say what each part of the script is for.

### More than one screen

When a feature has two sides (one person acts, another sees the result), declare `screens` instead of `url`. Each screen is its own browser page with its own cookies, so each can be a different user. All screens run for the whole recording, so changes made on one already show on the other when the video moves to it.

```yaml
screens:
  desk:
    url: http://localhost:3000/orders
    frame: browser-safari
  phone:
    url: http://localhost:4000/
    frame: mobile-iphone

steps:
  - action: click
    target: text=New order
    caption: Create an order

  - action: save
    as: link
    target: "#order-link"
    attribute: href

  - action: switch
    screen: phone
    caption: Open it on the phone

  - action: goto
    url: ${link}
```

- The first screen is on camera at the start. `switch` moves to another screen; the steps after it run there until the next `switch`. A switch keeps a short pause before and after, so there's no need for `wait` steps around it.
- `transition`: `fade` (default) or `slide`. A slide moves to the left when going to a screen listed later in `screens`, to the right when going back.
- `frame`: `browser-safari` (default), `browser-chrome`, `mobile-iphone` or `none`. A browser frame uses `viewport` (per screen, or the top-level one). A phone has its own screen size, so don't set `viewport` on it. Phones show taps instead of a cursor.
- Screen names start with a letter and use letters, digits, `-` and `_`.

### Values found during the recording

Some values only exist once the script runs. `save` reads one and stores it under a name; any later step can use it as `${name}` in any text: URLs, typed text, targets, captions.

```yaml
# An element's attribute. href comes back as a full URL.
- action: save
  as: link
  target: "#share"
  attribute: href

# An element's text.
- action: save
  as: id
  target: .record-id

# The current page URL, or the clipboard (after a step that copies).
- action: save
  as: page
  from: url
```

Names use letters, digits and `_`. `save` takes no time in the video.

### Steps that run but aren't recorded

Put preparation nobody needs to watch (signing in, opening the right page, closing a banner) between `pause-recording` and `resume-recording`, like the pause button on a screen recorder:

```yaml
- action: pause-recording

- action: type
  target: "#email"
  text: user@example.com

- action: type
  target: "#password"
  text: demo-password

- action: click
  target: "#submit"

- action: wait-for
  target: "text=Dashboard"

- action: resume-recording
```

- Paused at the start: the video begins at `resume-recording`, on the page the paused steps left behind.
- Paused in the middle, resumed on the same screen: that stretch is cut out. Whatever the paused steps changed just appears.
- Paused on one screen, resumed on another: a `switch` while paused prepares the other screen off camera. On resume the video moves straight to it, using the `transition` and `caption` of the last paused `switch`.
- Paused steps run at full speed. End the paused part with a `wait-for` on something the next visible step needs.
- Paused steps can't have captions, zoom or transitions (except that last `switch`), since they're never shown.

## 4. Check, then run

Run `opendemo check -` with the script. It lists every problem at once, each with the line, the step and how to fix it. Fix them all (use `opendemo docs <action>` when a step's fields are wrong) and check again until it prints `OK`. Only then record:

```sh
opendemo run - --out /tmp/demos/invite-flow.mp4 <<'EOF'
...the same script...
EOF
```

`--out` sets where the video goes. Always pass it: use the path the user asked for, or a folder outside their project, so the video and its work files don't end up in their repo. The recording (frames and a log, which can be large) is kept next to the video in `<video>.opendemo/`. Without `--out`, the video goes to the script's `output.path`, or `opendemo.mp4` in the current folder.

`run` prints the MP4 path. Run it in the background if it's long.

To change only the look (style, zoom, transitions, a caption's wording with the same number of words), pass the changed script to `opendemo render -` with the same `--out`. It reuses the recording. Anything else needs `run`.

## 5. Look at the video before handing it over

Extract a few frames and look at them:

```sh
ffmpeg -v error -i /tmp/demos/invite-flow.mp4 -vf "fps=1/2,scale=640:-1,tile=3x2" -frames:v 1 /tmp/demos/contact.jpg
```

Check that every step happened, zooms land on the right element, and captions are readable. If a step failed (the run errors with the selector), fix the selector and run again.
