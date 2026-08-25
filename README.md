# Aloud

Live speech transcription that runs entirely in the browser. The model is fetched once and
evaluated on your own machine, the audio never leaves the tab, and the transcript fills in
while you are still talking.

![Confirmed text in black, the current guess in amber, and the meters underneath](docs/screenshot.png)

## Why

Everything I could point at a work call wants the audio on someone else's server. That is a
reasonable trade for accuracy, and a bad one for a standup where somebody mentions a customer
by name. WebGPU and quantised Whisper make the other trade possible, and the point of the
benchmark below is to say exactly what that trade costs: on English, very little; on Russian,
more than I expected.

## Numbers

These come out of `pnpm bench`, which plays fixtures through the real pipeline in a real
Chromium, scores the transcript against a reference where there is one, and writes a report.
Latest run: q4 weights on WASM with twelve threads, one pass over the whole file.

| Language | Model | Clips | Reference words | WER    | Median WER | Mean cost |
| -------- | ----- | ----- | --------------- | ------ | ---------- | --------- |
| English  | tiny  | 2     | 39              | 2.6%   | 2.3%       | 0.24      |
| English  | base  | 2     | 39              | 0.0%   | 0.0%       | 0.48      |
| English  | small | 2     | 39              | 0.0%   | 0.0%       | 1.73      |
| Russian  | tiny  | 8     | 194             | 149.0% | 44.5%      | 0.57      |
| Russian  | base  | 8     | 194             | 25.3%  | 18.9%      | 0.75      |
| Russian  | small | 8     | 194             | 15.5%  | 13.7%      | 2.67      |

Cost is the real-time factor: seconds of compute per second of audio. Under 1 means it could
keep up with someone talking. WER is pooled, total errors over total reference words; the
median is there because of the next paragraph.

**That 149% is a decoder loop, not a typo.** On one six-second Russian clip, whisper-tiny
emitted the word "нет" a hundred and ninety-six times and nothing else. This is the failure
the stabiliser's loop trimming was written for, and the benchmark runs the model without the
stabiliser on purpose, so the number is what the raw model does. In the app that clip would
come out cut back to one "нет", which is wrong but not a wall. Consider it a measurement of
what that piece of the pipeline is worth.

**English is finished and Russian is not.** Two English clips, read speech and speech to a
crowd, are transcribed word for word by anything at base or above. Spontaneous Russian over a
phone-quality line is a median 19% wrong at base, ranging from 4% to 67% across eight clips.
whisper-small gets the median to 14%, but costs 2.7 times real time, and nearly 5 times in the
streaming loop.

So the honest shape of this project is **a live English transcriber, and a Russian one you
point at a recording and wait for.** The translate switch runs the same model on the same
audio, so translated Russian inherits the same recognition quality; it does not launder it.

The streaming loop, measured on a minute of English at real speed:

|                    | tiny  | base  | small  |
| ------------------ | ----- | ----- | ------ |
| cost               | 0.87  | 1.21  | 4.83   |
| confirmed lag, p50 | 2.7 s | 4.4 s | 10.0 s |
| confirmed lag, p90 | 7.3 s | 8.1 s | 15.0 s |

One more caveat, because it has bitten this project twice. Word error rate is only as good as
its text normaliser. Before this one spelled out "Mr." and turned "пятьдесят" into "50",
LibriSpeech scored 5.9% and the first Russian clip 27%, and every one of those errors was the
scoring rather than the model. A WER quoted without saying which normaliser produced it is not
a number.

The harness cannot get a GPU adapter here, headless or headed, so the table is WASM only, and
CI is WASM only as well because the runners have no graphics card. Measured by hand in a
desktop browser on the same machine, whisper-base at q4 sat around 0.62 on WebGPU against 0.28
on WASM: twelve CPU cores beat this laptop's GPU, which is not what I expected and is exactly
why the backend is a setting rather than a decision.

### Running it

```
pnpm bench
```

English audio is fetched at run time from Hugging Face. The eight Russian clips are committed,
about two megabytes, because the only source with both audio and a reference transcript hands
out URLs that expire. They come from SOVA RuDevices, CC BY 4.0. The report lands in
`packages/bench/report/`, and CI uploads it as an artifact.

Adding a fixture is an edit to `packages/bench/fixtures.json`. One with no reference is timed
but not scored, which is how the two English clips without transcripts earn their place.

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

What does not exist yet. The fixture set is twelve clips, ten of them scored, which is enough
to see the shape and not enough to publish. The microphone path has been exercised by hand
rather than by anything automated, because a benchmark cannot speak. And the summary is
English only, because the multilingual embedding model is 118 MB against 23.

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

**It is not as accurate as a paid API**, and on Russian it is not close. See the numbers: a
median 19% word error at base, 14% at small, and small costs nearly three times real time.
English is a different story and the numbers say so too.

**WebGPU is not automatically the fast one.** On the laptop this was built on, twelve CPU
cores beat the GPU by two to one. The backend is a setting for exactly that reason.
