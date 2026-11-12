# showem

Screen studio for your agent. Ask it for a demo, and showem turns a short script into a polished video.

https://github.com/user-attachments/assets/abb0d138-7a27-4473-bb26-444e62b96af4

## How it works

- your agent writes a short script: click this, type that, zoom in here
- showem plays it in a headless browser, so your screen and mouse stay yours
- then it adds zooms, a smooth cursor, captions and a browser or phone frame, and saves an MP4
- the first run downloads Chromium and ffmpeg into `~/.showem`

## Install

macOS only for now.

```sh
curl -fsSL https://showem.shaitar.com/install.sh | sh
```

Or install with:

- Homebrew: `brew install artsiomshaitar/tap/showem`
- a binary for [Apple silicon](https://github.com/artsiomshaitar/showem/releases/latest/download/showem-darwin-arm64.tar.gz) or [Intel](https://github.com/artsiomshaitar/showem/releases/latest/download/showem-darwin-x64.tar.gz). macOS blocks binaries downloaded in a browser, so after you unpack it, run `xattr -d com.apple.quarantine showem`

Homebrew sets up tab completion. Otherwise add `source <(showem completion zsh)` to `~/.zshrc`, or `source <(showem completion bash)` to `~/.bashrc`.

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

`showem docs` lists every action, and [`skill/showem/SKILL.md`](skill/showem/SKILL.md) is the full script format. For autocomplete in your editor, add this line at the top of the script:

```yaml
# yaml-language-server: $schema=https://showem.shaitar.com/schema.json
```

## FAQ

**Can it record native apps?**\
For now it can only record web apps. Native apps are coming soon.

**Does it support other platforms?**\
For now it only supports macOS. Linux support is coming soon.

**Is it free?**\
Yes, it's absolutely free and always will be. If you don't like something, just fork it - it's MIT.

## Development

```sh
bun install
bun test
bun src/cli.ts run examples/todo.demo.yaml
```

## Contributing

I don't accept pull requests, at least for now. If you have an idea, share it in [Ideas](https://github.com/artsiomshaitar/showem/discussions/categories/ideas). If something is broken, [open an issue](https://github.com/artsiomshaitar/showem/issues).

MIT licensed.
