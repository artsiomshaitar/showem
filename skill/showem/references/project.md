# Project settings

A project can keep showem's settings in a `.showem/` folder at its root. `showem init` creates it:

```
.showem/
  config.yaml     settings every script in the project uses (committed)
  .gitignore      keeps videos/ and env files out of git, except .env.example
  .env            secrets, like the voice's API key (not committed)
  videos/         where videos go when there's no --out (not committed)
```

Look for `.showem/config.yaml` before writing a script: showem finds it from the script's folder (or the current folder for a script from stdin) up.

## What the config sets

`showem docs config` lists every field the config takes, with what it does.

`style`, `output` (except `path`), `viewport`, `device-scale-factor`, `zoom`, `zoom-hold-ms` and `voice`. `~/.showem/config.yaml` sets the same fields for every project.

A script's own fields win over the project's, which win over `~/.showem`'s, field by field: a script with `style.background` still gets the config's `style.padding`. Don't repeat the config's fields in the script. Set one only when the user asks for something different in this video. Paths in a config are relative to its folder.

```yaml
style:
  background: backgrounds/brand.jpg   # .showem/backgrounds/brand.jpg
  padding: 0.07
output:
  width: 2560
  height: 1440
voice:
  provider: elevenlabs
  voice: <voice id>
  api-key: ${{ env.ELEVENLABS_API_KEY }}
```

## Voice providers

`voice` takes either a `provider` or a `base-url`:

- `provider: elevenlabs`: ElevenLabs' own API. `model` is optional (default `eleven_v4`).
- `provider: openai` or `provider: openrouter`: OpenAI's speech API, at that service. Needs `model`.
- No `provider`, a `base-url`: any other server with OpenAI's speech API, like a local Kokoro, Qwen3-TTS or Chatterbox server, or a LiteLLM proxy. Needs `model`; `api-key` only if the server asks for one.

```yaml
voice:
  base-url: http://localhost:8880/v1
  model: kokoro
  voice: af_heart
```

`instructions` (one line on how to speak) works with models that take it, like OpenAI's. `extra` adds any other fields to each request, for servers with their own options (mlx-audio's Qwen3-TTS takes its tone direction as `instruct`, and Kokoro, which has no tone control, a faster pace as `speed: 1.1`). `audio-tags: true` tells showem a model performs `[audio tags]`; see [voice.md](voice.md).

## Secrets

`api-key` names an environment variable, GitHub Actions style: `${{ env.NAME }}`. The value comes from the environment, then `.showem/.env`, then the `.env` at the project root. showem refuses a key written into the config itself. Never read, print or ask for the key: if it's missing, `showem check` says which variable to set, and the user sets it.

## Videos and build files

In a project with `.showem/`, leave out `--out` and the video goes to `.showem/videos/<script name>.mp4`. Pass `--out` to keep several versions of one script.

Frames and other build files go to the system's temp folder, one folder per video path. `showem clean` deletes them. `render` needs them, so after `clean` (or a restart) use `run`.
