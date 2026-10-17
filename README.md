# Aloud

Live captions in the browser. Talk, or play a call in another tab, and the text shows up about
a second later. The speech model runs on your own machine, so the audio never leaves the tab.
English only.

![A file playing at real speed: the first line settled in black, the next still an amber guess](docs/screenshot.png)

I built it because every transcription tool I could point at a work call wants the audio on
someone else's server. A small model on WebAssembly turned out to be good enough, and the
benchmark below says how good.

Audio from the mic, a tab or a WAV file goes through Silero voice detection, gets cut into
lines at the pauses and is handed to Moonshine in a worker. The line you are still saying is
re-read every 0.6 s and shown in amber. When you pause it gets one last pass and turns black.
Lines can be searched and exported as Markdown, a timestamp replays that moment, and the last
ten sessions stay in IndexedDB.

## Numbers

From `pnpm bench`, which runs the same pipeline in a real Chromium. q8 weights, WASM, twelve
threads.

| Model                        | Download | WER  | Cost, file | Cost, live | Lag p50 |
| ---------------------------- | -------- | ---- | ---------- | ---------- | ------- |
| moonshine-tiny               | 32 MB    | 5.1% | 0.09       | 0.53       | 1.0 s   |
| moonshine-base               | 67 MB    | 0.0% | 0.21       | 0.78       | 1.5 s   |
| whisper-base (first version) | 149 MB   | 0.0% | 0.48       | 1.21       | 4.4 s   |

Cost is seconds of compute per second of audio, so under 1 keeps up. Lag runs from the end of
a line to its final text. WER is two clips and 39 words: a sanity check, not a result.

## Running it

Node 24 and pnpm 10.

```
pnpm install
pnpm dev
```

The first start downloads the model, after that it is cached. `pnpm test` runs the unit tests,
`pnpm bench` the benchmark.

The host has to send two headers, or onnxruntime runs on one thread at about half the speed:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

They live in `packages/app/public/_headers` together with the CSP. Cloudflare serves the build
as a static-assets Worker (`wrangler.jsonc`) and redeploys on every push to `main`.

```
packages/core   audio, voice detection, the segmenter and both worker protocols, with the tests
packages/app    Angular 22, zoneless, signals
packages/bench  the benchmark, a Playwright-driven page over the same core
```

## Privacy

There is no backend and no analytics. The only thing fetched is the model, from Hugging Face,
pinned to a commit, and onnxruntime ships inside the build instead of coming from a CDN. The
CSP lets the page talk to itself and to Hugging Face's file hosts, with no `unsafe-eval` and no
`blob:` scripts. Settings shows how much disk the models take and can remove them, or stop
keeping them between visits.

CI runs `pnpm audit` on the production dependencies. The one advisory left open, in
`sprintf-js`, comes in through `onnxruntime-node`, which never reaches a browser.

## Known issues

- English only. The first version ran Whisper and did Russian, but 19% WER on real speech was
  not worth 149 MB.
- No transcription offline, even with everything cached. transformers.js looks for the
  preprocessor under `main` instead of the pinned commit, misses the cache and gives up. The
  page itself does open offline.
- WAV files only, up to 500 MB.
- No speaker labels, and the "gist" is picked lines rather than a written summary.
- Nothing tests the mic path automatically. A benchmark cannot talk.

## What I'd do differently

Start with Moonshine. Whisper pads every window to thirty seconds, so each pass cost a second
whatever was in it, and I ended up building a word-agreement stabiliser to hide the lag
([write-up](docs/local-agreement.md)). Moonshine reads a short line in a fraction of that, so
lines can just end at the pauses. The switch cost Russian and took the download from 149 MB
to 32.

Write the scorer first. WER came out wrong twice, both times because of the text normaliser
and not the model. These days a surprising number is a suspect number until proven otherwise.
