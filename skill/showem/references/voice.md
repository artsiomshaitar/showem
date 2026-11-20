# Voice

When the project's config has a `voice` (see [project.md](project.md)), `run` reads every shown caption aloud with the configured text-to-speech service and puts the narration in the video. `showem check` prints which voice it is and whether it performs audio tags. The caption on screen and the words said are the same text, so write each caption as something a narrator says.

## How it's timed

- A caption shows and its voice starts at the same moment.
- The step's action starts shortly before the sentence ends, so the pointer arrives and clicks as the narrator finishes. Words and what they describe land together, which is what viewers follow best.
- The next caption waits until this one has been said, plus a short breath.
- Steps without an action (`wait`, `wait-for`, `save`) last at least as long as their caption takes to say.

So put what the step does at the end of the sentence: "Now add it to the list" clicks Add as "list" is said. "Add it to the list, and it shows up below" clicks too early.

## Writing captions to be said

- One sentence per caption, about 5 to 12 words. A long sentence makes its step wait.
- Write like you talk: contractions ("it's", "you'll"), plain words, no headline fragments. "Your whole week, at a glance." works; "Weekly overview" doesn't.
- Punctuation is the voice's rhythm. A comma is a breath and a period is a full stop. Use them on purpose. With a model that performs audio tags, `...` is a beat of hesitation or suspense. With one that doesn't (see the `Voice:` line from `showem check`), don't use `...`: those models often trail off into a whisper. Use a comma or a period instead.
- Spell out what's awkward to say: numbers as words when they're short ("three tasks"), no URLs, no file paths, no symbols. Write keys and shortcuts as words ("press Enter", "Command K"), never in brackets.
- Vary the openings. Ten captions that all start with "Click" sound robotic. Say what the viewer gets ("Your changes save on their own") more than what the hand does.
- Words in capitals are stressed. Use it for one word at most, rarely.

## Audio tags

Square brackets in a caption are audio tags: the voice performs them, and they never show on screen. Only some models perform them (ElevenLabs v3 and v4, or a model the config marks with `audio-tags: true`). For the others, showem takes the tags out before the caption is said. Check the `Voice:` line from `showem check`: if it says tags are taken out, don't write them, and use punctuation for pauses instead.

```yaml
caption: "[warmly] Your whole week, at a glance."
caption: Pick a time... [short pause] and you're booked.
caption: "[excited] And it's already shared with the team."
```

- Quote the caption when it starts with `[`, or YAML reads it as a list.
- A tag goes right before the words it changes, or right after them for a reaction (`It just works. [chuckles]`).
- Most captions need no tag. One or two tags in a whole video gives life; one on every line sounds like acting. Good spots: the opening line, the payoff at the end.
- Pick tags a product narrator would use: `[warmly]`, `[cheerfully]`, `[curious]`, `[excited]`, `[reassuring]`, `[chuckles]`, `[short pause]`, `[long pause]`. Avoid sound effects (`[applause]`), accents, and tags that fight the voice (a calm voice won't shout).
- For a pause, use `[short pause]` or `...`. SSML `<break>` tags don't work with the default model.

## Cost

Hosted services charge per character said (ElevenLabs: about one credit per character). Local servers are free. Each clip is cached by its text and the voice, so recording again only pays for captions that changed. With ElevenLabs each clip is also said with its neighbors for a natural flow, so a changed caption also re-reads the ones next to it. Don't re-record just to hear small wording changes: change all the captions you want first, then run once.

ElevenLabs' free plan can only use its default voices through the API. A Voice Library voice fails with a `402` error until the user upgrades.

ElevenLabs' own guide has more on tags and pacing: https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices.md
