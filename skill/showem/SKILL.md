---
name: showem
description: Record a polished demo video of a web app without touching the user's screen. Use when the user asks for a demo, demo video, screen recording, product video, or a video showing a feature or a pull request. Runs a headless browser, then renders zooms, a smooth cursor, captions, motion blur and a background into an MP4.
---

# Make a demo video with showem

showem runs a step script in a headless browser and renders the video. The user's screen and mouse are never used, so they can keep working.

## 1. Understand the app first

If you can read the app's code, read how the flow works before you write any steps:

- What each action changes, and what appears after it (a new row, a dialog, a different page).
- Which values only exist while the script runs (an ID or link the flow creates). Read those with `save`. Never make them up or write them into the script.
- Take selectors and URLs from the code. Never guess them.

Make sure the app is running and has realistic data. If it's already running, use it as it is: never stop or restart servers you didn't start. No secrets or personal data on screen.

## 2. Plan

- One message per video. Decide what the viewer should remember.
- Do what the user asked. If they don't want to see a part, it goes between `pause-recording` and `resume-recording`. If they ask for a quick video, keep it short.
- Keep it as short as the request allows: one scene per point the user asked to see. Each important step gets a caption of 10 words or fewer (one spoken sentence with a voice).

## 3. Write the script

Scripts are YAML (JSON works too, with the same fields). Pass the script to showem on stdin with `-`. Don't save it to a file unless the user asks for one:

```sh
showem check - <<'EOF'
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

Always quote the marker (`<<'EOF'`), or the shell replaces `${name}` before showem sees it. Relative paths and URLs resolve from the current folder (from the script's folder when it's a file).

Before writing steps, read [references/script.md](references/script.md): every field, how captions work, zoom, several screens, values saved during the recording, and steps that aren't recorded. For one action's fields, run `showem docs <action>`. Don't guess field names.

Before writing, look for `.showem/config.yaml` in the project. If there is one, read [references/project.md](references/project.md): the script gets its settings from it. If the config has a `voice`, also read [references/voice.md](references/voice.md) before writing any caption, since every caption is said aloud.

## 4. Check, try, then run

Run `showem check -` with the script. It lists every problem at once, each with the line, the step and how to fix it. Fix them all (use `showem docs <action>` when a step's fields are wrong) and check again until it prints `OK`.

Then run `showem try -` with the script and the same `--out` you'll record with. It runs the steps in the browser at full speed, without recording or rendering and skipping `wait` steps, so it takes seconds. A `wait` is only for viewers: to wait for the app, use `wait-for`. It stops at the first step that fails, with its line and the error, and saves a screenshot of each screen where it stopped (or at the end). Look at the screenshots, fix the script, and try again until it prints `OK`. Use it instead of writing your own browser scripts to test selectors. The steps really run, so anything they change in the app stays changed: put the app's data back before recording if the flow needs it.

Only then record:

```sh
showem run - --out /tmp/demos/invite-flow.mp4 <<'EOF'
...the same script...
EOF
```

`--out` sets where the video goes. Pass it unless the project has a `.showem/` folder: use the path the user asked for, or a folder outside their project, so the video doesn't end up in their repo. In a project with `.showem/`, leave `--out` out and the video goes to `.showem/videos/`, which git ignores.

`run` prints the MP4 path. Run it in the background if it's long.

If the browser stopped drawing for a moment while the page was changing, `run` says which step and when, and the video jumps there. A hiccup is usually gone on the next try: record again, after putting the app's data back if the flow changed it. If it comes back at the same step, the app itself is busy there, and recording again won't help.

To change only the look (style, zoom, transitions, a caption's wording with the same number of words), pass the changed script to `showem render -` with the same `--out`. It reuses the recording. Anything else needs `run`. With a voice, any caption change needs `run`, since the narration sets the timing.

## 5. Look at the video before handing it over

Extract a few frames and look at them:

```sh
ffmpeg -v error -i /tmp/demos/invite-flow.mp4 -vf "fps=1/2,scale=640:-1,tile=3x2" -frames:v 1 /tmp/demos/contact.jpg
```

If `ffmpeg` isn't on the PATH, use the one showem downloaded: `~/.showem/ffmpeg-*/ffmpeg`.

Check that every step happened, zooms land on the right element, and captions are readable. If a step failed, fix it with `showem try` and run again. With a voice, also check that the captions read like natural speech; you can't hear the video, so tell the user it's narrated and ask them to listen.
