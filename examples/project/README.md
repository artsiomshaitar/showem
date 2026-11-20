# Notes

An example project set up for showem: a small app in `src/`, demo scripts in `demos/`, and showem's settings in `.showem/`.

```
.showem/
  config.yaml         settings every demo uses (background, video size), committed
  backgrounds/        images the config points to, committed
  .env                secrets like ELEVENLABS_API_KEY, not committed
  .gitignore          keeps videos/ and .env out of git
  videos/             where the videos go, not committed
demos/                one script per video
src/                  the app
```

`showem init` creates `.showem/` with an empty config. Then:

```sh
showem run demos/new-note.yaml   # → .showem/videos/new-note.mp4
showem run demos/launch.yaml     # its own background, the rest from the config
```

A script's own fields win over the config. Frames and other build files go to the system's temp folder, and `showem clean` deletes them.
