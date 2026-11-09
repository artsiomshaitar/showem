# showem

Screen studio for your agent.

Your agent writes a short script. showem plays it in a headless browser and turns it into a polished video with zooms, a smooth cursor and captions. It never touches your screen.

## Install

```sh
curl -fsSL https://showem.shaitar.com/install | sh
```

Or with Homebrew:

```sh
brew install artsiomshaitar/tap/showem
```

macOS only for now. The first run downloads Chromium and ffmpeg into `~/.showem`.

## Give it to your agent

```sh
npx skills add artsiomshaitar/showem
```

Then ask it for a demo: "record a video of the new signup flow".

## Or write the script yourself

```yaml
url: http://localhost:3000
steps:
  - action: click
    target: text=New project
    zoom: true
    caption: Create a project
```

```sh
showem run demo.yaml
```

`showem docs` lists every action. For autocomplete in your editor, add this line at the top of the script:

```yaml
# yaml-language-server: $schema=https://showem.shaitar.com/schema.json
```

## Development

```sh
bun install
bun test
bun src/cli.ts run examples/todo.demo.yaml
```

## License

MIT
