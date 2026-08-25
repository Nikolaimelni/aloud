# Aloud

Live speech transcription that runs entirely in the browser. The model is fetched once and
evaluated on your own machine, the audio never leaves the tab, and the transcript fills in
while you are still talking.

![Confirmed text in black, the current guess in amber, and the meters underneath](docs/screenshot.png)

## Why

Everything I could point at a work call wants the audio on someone else's server. That is a
reasonable trade for accuracy, and a bad one for a standup where somebody mentions a
customer by name. WebGPU and quantised Whisper have made the other trade viable: slower and
a few points worse, but nothing to upload and nothing to delete afterwards.

## Numbers

There is a benchmark harness now, so these are produced by `pnpm bench` rather than by me
driving a browser and writing down what I saw. It plays fixtures through the real pipeline in
a real Chromium, scores the transcript against a reference where there is one, and writes a
JSON and a Markdown report.

Latest run, whisper at q4 on WASM with twelve threads, window step 1.5 s:

| Fixture           | Model | Mode      | Audio  | RTF  | WER  | Lag p50 | Lag p90 |
| ----------------- | ----- | --------- | ------ | ---- | ---- | ------- | ------- |
| librispeech-clean | tiny  | one pass  | 5.9 s  | 0.23 | 0.0% |         |         |
| librispeech-clean | base  | one pass  | 5.9 s  | 0.58 | 0.0% |         |         |
| jfk               | tiny  | one pass  | 11 s   | 0.15 | 4.5% |         |         |
| jfk               | base  | one pass  | 11 s   | 0.32 | 0.0% |         |         |
| dialogue          | tiny  | one pass  | 8 s    | 0.21 |      |         |         |
| dialogue          | base  | one pass  | 8 s    | 0.46 |      |         |         |
| russian           | tiny  | one pass  | 10.1 s | 0.21 |      |         |         |
| russian           | base  | one pass  | 10.1 s | 0.45 |      |         |         |
| ted-60s           | tiny  | streaming | 60 s   | 1.00 |      | 3.4 s   | 8.6 s   |
| ted-60s           | base  | streaming | 60 s   | 1.50 |      | 6.4 s   | 9.6 s   |

What to read out of that.

Streaming costs four to five times a single pass over the same audio, because every second
goes through the model several times before two passes agree on it. In this Chromium,
whisper-base streaming runs at 1.5 times real time, which means it does not keep up;
whisper-tiny sits at exactly 1.00, which means it only just does. The confirmed text runs
three to six seconds behind at the median and around nine at the ninetieth percentile.

The word error rates are on two short English clips, which is not a benchmark, it is a smoke
test with arithmetic. The Russian fixture has no reference transcript yet so it is only
timed. Growing that set is an edit to `packages/bench/fixtures.json` and the most useful
single thing left to do.

One normalisation detail worth the warning: before the normaliser spelled out "Mr." as
"mister", LibriSpeech scored 5.9% and it was entirely that one word. Whisper evaluations live
or die on text normalisation, and a WER quoted without saying which normaliser produced it is
not a number.

The harness cannot get a GPU adapter here, headless or headed, so the table is WASM only, and
CI is WASM only as well because the runners have no graphics card. Measured by hand in a
desktop browser on the same machine, whisper-base at q4 sat around 0.62 on WebGPU against
0.28 on WASM: twelve CPU cores beat this laptop's GPU, which is not what I expected and is
exactly why the backend is a setting rather than a decision.

### Running it

```
pnpm bench
```

Fixtures are fetched at run time from Hugging Face, so the repository stays small. The report
lands in `packages/bench/report/`, and CI uploads it as an artifact.

## Latency, in structure

A word is printed as final only when two consecutive passes agree on it, so in the worst case
it waits out a window step, then a pass, then another step, then another pass. The step is the
part you pay for twice, which is why raising it does not help: at 2.2 seconds the lag got
worse, not better.

A pass costs about a second whatever the window contains, because Whisper's encoder pads
every window to thirty seconds. That is the floor under the step, and it is why getting this
down to a second of lag needs a smaller model or a faster machine rather than a better
setting.

## Privacy

The audio never goes anywhere. There is no server to send it to: the whole pipeline is four
threads in your tab.

Two things are fetched over the network, both on the first run and both cached afterwards.
The model weights come from huggingface.co, and onnxruntime's WebAssembly comes from
jsDelivr. After that it opens with the network off. Nothing is sent the other way: no
analytics, no error reporting, no account, no request that carries a word of what you said.

Recordings and transcripts are kept in IndexedDB on the machine you used, the last ten
sessions, and "Delete all" means it. Clearing the site data clears them too, along with the
cached weights.

Capturing another tab shows the browser's own sharing indicator the whole time, which is the
browser telling you the truth about what is being read.

## Status

Week 6 of six. What exists:

- pnpm workspace, strict TypeScript, lint, CI
- `AudioWorklet` capture with a level meter
- a polyphase resampler to 16 kHz, with the anti-alias tests that justify writing one
- a WAV reader and a file-backed `AudioSource`, so the pipeline can run without a browser
- Whisper in a worker on WebGPU or WASM, transcribing a whole file and reporting its cost
- Silero voice activity detection in a second worker
- the sliding window chunker and the local-agreement stabiliser, with their tests
- one live view: microphone, another tab's audio, or a WAV file, all through the same
  pipeline, with confirmed text in black and the current guess in amber
- meters for what it costs: backend, real-time factor, how far the confirmed text is running
  behind, how much audio is queued
- timestamps you can click to hear that moment again, search across the transcript, and a
  Markdown export
- a translate switch, which is the same model and the same pass: speak Russian, read English
- the last ten sessions kept in IndexedDB, transcript and audio, reopenable

- a benchmark harness: fixtures, word error rate, real-time factor, confirmation lag
  percentiles, a report in CI artifacts
- a service worker, so the page itself opens with the network off and not just the weights,
  with a Playwright test that cuts the network and reloads to prove it
- an extractive summary: sentence embeddings, then the lines closest to the centre of what was
  said that are not repeats of each other
- a phone gets the small model by default, the download size is on the button before you tap
  it, and a tab sent to the background says so instead of pretending to listen
- new words are announced to a screen reader once, rather than the whole transcript being
  read again every time the guess changes

What does not exist yet. The fixture set is five clips with two references, which is enough to
prove the harness and not enough to characterise the model. The microphone path has been
exercised by hand rather than by anything automated, because a benchmark cannot speak. And the
summary is English only, because the multilingual embedding model is 118 MB against 23.

## Running it

Node 24 (see `.nvmrc`) and pnpm 10.

```
pnpm install
pnpm dev
```

Pick a file and a model. The weights download once, then stay in the browser cache, so the
first run is slow and the rest are not.

## Layout

```
packages/core   audio sources, resampling, WAV in and out, voice activity, windowing, the
                stabiliser, the inference engine and both worker protocols
packages/app    Angular 22, zoneless, signals; owns the worklet asset, the two Workers and
                the IndexedDB archive
packages/bench  a page with no interface, driven by Playwright, that measures the same core
```

Audio sits behind an `AudioSource` adapter and the model behind a worker protocol. Neither
knows about the other, and neither knows whether a person or a fixture is on the far end.
That is what makes the week 5 accuracy run possible at all.

## Things it will not do

**It is not instant on a phone.** The first visit downloads about 96 MB before it can
transcribe anything, and the button says so before you tap it. After that the weights are
cached and it starts in a second.

**It does not label speakers.** Working out who said what needs a separate embedding model
plus clustering, and it fails loudly enough that people trust the whole transcript less.

**It does not write the summary, it picks it.** The gist is lines lifted out of the
transcript by similarity, never rewritten, because an abstractive summary needs a second
language model and a new way to be confidently wrong about what somebody said. It also only
works on English; a Russian transcript is better summarised after translating it, which the
app can do in the same pass.

**It is not as accurate as a paid API.** It is whisper-tiny or whisper-base, quantised to
four bits, and on hard audio it will show you. The benchmark above is two easy English clips;
treat it as a smoke test with arithmetic rather than a claim.

**WebGPU is not automatically the fast one.** On the laptop this was built on, twelve CPU
cores beat the GPU by two to one. The backend is a setting for exactly that reason.
