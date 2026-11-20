# Script reference

Every top-level field, in a full script:

```yaml
url: http://localhost:3000
viewport:
  width: 1440
  height: 900
zoom: 1.8                 # the scale of `zoom: true` steps and `zoom-in`
zoom-hold-ms: 300         # how long the camera stays zoomed after a step
output:
  path: demo.mp4
  width: 2560
  height: 1440
  fps: 60
  bitrate: 8              # Mbps, higher is sharper and bigger; leave it out for constant quality
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

## Steps

Each step is a list item that starts with `action:`. Its other fields go on the lines below, lined up with `action:`. All names are kebab-case. Write one field per line, not `{ ... }` on one line, and put a blank line between steps.

The actions are `goto`, `click`, `hover`, `drag`, `type`, `select`, `press`, `scroll`, `wait-for`, `wait`, `switch`, `save`, `zoom-in`, `zoom-out`, `pause-recording` and `resume-recording`. For the exact fields:

```sh
showem docs           # every top-level field, how steps work, and the list of actions
showem docs click     # one action: what it does, its fields, and an example
```

Look up an action with `showem docs <action>` before using a field you're not sure about. Don't guess field names.

## Captions

Every step except `pause-recording` and `resume-recording` can have a `caption`. It stays on screen until the next caption. The caption shows first and the step waits until it can be read, so viewers read it and then watch what happens. With a voice (see [voice.md](voice.md)), the caption is also said, and the step's action lands as the sentence ends instead. Text in square brackets, like `[warmly]`, is an audio tag for the voice and never shows on screen, so don't put brackets in a caption for any other reason. When a step acts on something the caption would cover (a button at the bottom of the page), showem lifts the window above the caption for that step on its own, so there's no need to zoom or reword to avoid it.

## Step fields

- `target` is a Playwright selector: `text=Save`, `#id`, `button:has-text("Save")`, `[data-testid=x]`. Put quotes around any selector that starts with `#`, or YAML reads it as a comment.
- `select` picks a dropdown option by its visible text (`option: Waiting on parts`). Use it for every dropdown, native `<select>` or one made of page elements: showem tells them apart and shows the menu in the video either way. For a native one, `target` is the `<select>`; otherwise it's the element that opens the dropdown.
- `type` adds its text to the end of what the field already holds. To replace it, select it first with a `press` of `ControlOrMeta+A`, then type. The pointer clicks text fields where a person would: near the start of an empty one, over the text in a filled one.
- `type` works on native date and time inputs too: write the value (`2:00 PM`, `2026-11-07`, `2026-11-07T14:00`) and showem types it into the input's parts. Don't press keys to move between the parts.
- `drag` presses on `target`, moves with the button held, and lets go: over the center of another element (`to`), or a number of pixels away (`by` with `x` and `y`). Use it for anything moved or resized with the mouse: a panel edge, a window, a slider, a card dropped in another list. Target the exact thing that is grabbed (the edge handle, the title bar), not the whole panel. The drop point is measured before the drag starts and must be on screen. With `zoom`, the camera frames the whole move. Not on phone screens. Native HTML drag and drop (`draggable`) shows no dragged image in the video, since the browser draws it outside the page.
- To show something without pointing at it, `scroll` with `target` brings it smoothly into view. Steps that point at an element already scroll to it. `y` (pixels) is for scrolling by an amount.
- `zoom` (on click, hover, drag, type, select): `true` uses the script's `zoom` scale, a number zooms to that scale. Zoom on the steps that matter, not on every step. Close zooms are joined into one smooth pan. On a zoomed `type` step the camera follows the word being typed.
- `keep-in-view`: a list of other elements to keep in frame with the target while zoomed, usually what the step changes (a new row, a toast). The camera zooms out below the scale if they don't fit.
- `zoom-in` and `zoom-out`: zoom in on an element (a form, a dialog, a menu) and stay zoomed for several steps, until `zoom-out`, a `goto` or a `switch`. The camera follows the steps inside it. `keep-in-view` works on it too: list the elements to show and the camera frames them all.
- Choosing between them: `zoom` is for a moment, `zoom-in` is for a scene. When one step is the point and the camera can pull back after it, use `zoom` on that step: it zooms in as the pointer arrives and out on its own. When the viewer should stay close for a while (several steps in one area, a pause to read something, steps like `press` or `wait` that can't zoom), use `zoom-in` and `zoom-out` around them.
- Start with a `wait` of about 1 s so viewers see the starting state, and end with one too.
- Use `#` comments to say what each part of the script is for.

## More than one screen

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

## Values found during the recording

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

## Steps that run but aren't recorded

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
