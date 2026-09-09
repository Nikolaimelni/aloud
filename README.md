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
q4 weights on WASM with twelve threads, one pass over the whole file. The error rates come out
identical on every run; the costs move, for reasons further down.

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

That 149% comes from one runaway clip. On a six-second Russian recording, whisper-tiny
emitted the word "нет" a hundred and ninety-six times and nothing else, eleven hundred
characters of it. The clip really does open with someone saying "не" five times over, and the
model latched on and never let go.

That clip is also run through the streaming path, so the two can be compared directly:

| ru-03, whisper-tiny | one pass        | streaming    |
| ------------------- | --------------- | ------------ |
| WER                 | 853.8%          | 96.2%        |
| what came out       | 1109 characters | 7 characters |
| cost                | 2.1 to 2.5      | 6.1 to 7.8   |

The stabiliser's loop trimming is what closes that gap. It does not rescue the content, the
model simply cannot do this clip at tiny, but it turns a page of noise into an obviously empty
answer, which is the better way to be wrong. Note the cost column too: when the model loops,
every window loops, and the streaming pipeline burns six to eight times real time doing it.
That is exactly when the interface says it is falling behind.

The trimming only ever looks at the end of a hypothesis, because that is where a runaway
decoder lives: it never stops, so the repetition is always at the tail. A repetition in the
middle of a sentence is left alone. A genuine one at the end is not, and there are tests
saying so in both directions.

There is a longer write-up of the streaming design and everything that went wrong building it
in [docs/local-agreement.md](docs/local-agreement.md).

English is finished and Russian is not. Two English clips, read speech and speech to a
crowd, are transcribed word for word by anything at base or above. Spontaneous Russian over a
phone-quality line is a median 19% wrong at base, ranging from 4% to 67% across eight clips.
whisper-small gets the median to 14%, but costs 2.7 times real time, and nearly 5 times in the
streaming loop.

So the honest shape of this project is a live English transcriber, and a Russian one you
point at a recording and wait for. The translate switch runs the same model on the same
audio, so translated Russian inherits the same recognition quality; it does not launder it.

The streaming loop, measured on a minute of English at real speed:

|                    | tiny  | base  | small  |
| ------------------ | ----- | ----- | ------ |
| cost               | 0.87  | 1.21  | 4.83   |
| confirmed lag, p50 | 2.7 s | 4.4 s | 10.0 s |
| confirmed lag, p90 | 7.3 s | 8.1 s | 15.0 s |

The ru-03 costs come from two runs after a fix to the end of a stream. The pipeline used to
count its last pass twice, and when a pass was still running at the end it ran the final
window twice as well; on a six-second clip that was most of the old figure of 15.5. On the
minute of English it is one pass in thirty, well inside the spread between runs, so this
table is still the earlier run.

The spread is wide. The same one-pass work, same audio in and the same text out, has run up
to 1.9 times slower from one run to the next on this laptop, and seven streaming runs of the
same code put tiny anywhere from 0.87 to 1.2. Compare numbers within a run, not across runs.

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

### Running the benchmark

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

The model weights are the one thing fetched over the network: from huggingface.co, on the
first run, pinned to a commit and cached afterwards. onnxruntime's WebAssembly ships inside
the build rather than coming from a CDN, so no code runs in the tab that did not come from
this repository's lockfile. After that it opens with the network off. Nothing is sent the
other way: no analytics, no error reporting, no account, no request that carries a word of
what you said. The Content-Security-Policy holds the page to that, since it may only connect
to itself and to Hugging Face.

Recordings and transcripts are kept in IndexedDB on the machine you used, the last ten
sessions, and "Delete all" means it. Clearing the site data clears them too, along with the
cached weights.

Capturing another tab shows the browser's own sharing indicator the whole time, which is the
browser telling you the truth about what is being read.

## Status

The plan is done. What exists:

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
- a translate switch, the same model in the same pass: speak Russian, read English, with the
  Russian recognition being exactly as good or bad as the numbers above say
- the last ten sessions kept in IndexedDB, transcript and audio, reopenable
- a benchmark harness: fixtures, word error rate, real-time factor, confirmation lag
  percentiles, a report in CI artifacts
- a service worker, so the page itself opens with the network off and not just the weights,
  with a Playwright test that cuts the network and reloads to prove it
- an extractive summary: sentence embeddings, then the lines closest to the centre of what was
  said that are not repeats of each other
- a phone gets whisper-tiny by default, the download size is on the button before you tap it,
  and a tab sent to the background says so instead of pretending to listen
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

`pnpm install` will mention three dependencies whose build scripts it skipped:
`onnxruntime-node`, `sharp` and `protobufjs`. They arrive with transformers.js, which also
runs on a server and on images, and none of them is reachable from a browser tab. Leave them
unbuilt.

The one thing a host has to get right is the headers, and two of them carry the speed:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

They are what lets onnxruntime start its thread pool, which is worth roughly a factor of two
on WASM, and the `credentialless` variant is what still allows the weights to come from
Hugging Face. `packages/app/public/_headers` asks Cloudflare Pages for them and ships in the
build output, together with the CSP. That policy carries `'unsafe-eval'`, because onnxruntime's
asyncify and WebGPU builds make functions with `new Function`; `connect-src` is the part doing
the work. The offline test serves the build with the same file. Anywhere else, set them
yourself; without the first two the app works and is half the speed.

```
pnpm build
pnpm dlx wrangler pages deploy packages/app/dist/app/browser --project-name aloud
```

The build copies two onnxruntime builds into `ort/`, about 36 MB. The larger file is 23.6 MB,
which fits under the 25 MB Pages allows per file, but not by much.

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
That adapter is the reason the benchmark exists at all: the same pipeline runs with a
microphone on one end or a WAV file on the other, and only the file version can be scored.

## Things it will not do

It is not instant on a phone: the first visit downloads about 96 MB before it can transcribe
anything, and the button says so before you tap it. After that the weights are cached and it
starts in a second.

Speakers are not labelled. Working out who said what needs a separate embedding model plus
clustering, and it fails loudly enough that people trust the whole transcript less.

The gist is lines lifted out of the transcript by similarity and left as they were, because
an abstractive summary needs a second language model and a new way to be confidently wrong
about what somebody said. It also only works on English; a Russian transcript is better
summarised after translating it, which the app can do in the same pass.

A paid API is more accurate, and on Russian it is not close. See the numbers: a median 19%
word error at base, 14% at small, and small costs nearly three times real time. English is a
different story and the numbers say so too.

WebGPU does not make it fast by itself. On the laptop this was built on, twelve CPU cores beat
the GPU by two to one, so the backend is a setting rather than a guess.

## What I would do differently

I wrote a latency budget before I could measure anything, and it was out by a factor of four.
The arithmetic was fine and the shape was wrong: I had the lag as one window step plus one
pass, when it is two of each, because local agreement needs the same audio to come round
twice. No amount of tuning the step fixes that, and I spent a day finding out by tuning the
step. The budget table stayed in the README next to the measurement for a while, which was the
most useful thing about it.

The measurement bugs outnumbered the code bugs. The word error rate was wrong twice, both
times because the normaliser scored "Mr." against "MISTER" and "50" against "пятьдесят" as
mistakes. The offline test failed twice, both times because of headers and timing in the test
rather than anything in the app. If I started again I would write the scorer and its tests
before the thing being scored, and I would treat a surprising measurement as a suspect
measurement first.

Two panels was wasted motion. The first version grew a "transcribe a file" panel and a
"stream a file" panel side by side, and the next one deleted both for one view with a source
picker. The pipeline underneath never changed. I should have built the source picker on day
one and let the file be a source like any other, which is what the `AudioSource` adapter was
for in the first place.

The SharedArrayBuffer ring never got built. The plan called for one, the capture worklet
still allocates a four kilobyte buffer on the audio thread fifty times a second, and nothing
has glitched. Leaving it is the right call on the evidence and it is still the piece I would
reach for first if a dropout ever showed up.

Whisper is the wrong shape for this and I would pick it again. An encoder that pads every
window to thirty seconds is the reason a pass costs a fixed second and the reason live Russian
is out of reach here. A model built for streaming would be better at this job. It would also
not have twenty language-quality comparisons, four quantisations and an ONNX export that runs
in a browser tab today.
