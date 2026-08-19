# Aloud

Live speech transcription that runs entirely in the browser. The model is fetched once and
evaluated on your own machine, the audio never leaves the tab, and the transcript fills in
while you are still talking.

It is also unfinished. See Status before you clone it expecting a live transcript.

## Why

Everything I could point at a work call wants the audio on someone else's server. That is a
reasonable trade for accuracy, and a bad one for a standup where somebody mentions a
customer by name. WebGPU and quantised Whisper have made the other trade viable: slower and
a few points worse, but nothing to upload and nothing to delete afterwards.

## Latency, honestly

Real-time here does not mean instant. Capture is cheap and the model is not.

| Stage                       | Cost                          |
| --------------------------- | ----------------------------- |
| Capture, resample to 16 kHz | ~60 ms                        |
| Voice activity              | ~100 ms                       |
| One pass over the window    | 1.3-2.1 s, mostly fixed       |
| Confirmation                | that pass has to happen twice |

A word is printed as final only when two consecutive passes agree on it, so in the worst
case it waits out a window step, then a pass, then another step, then another pass.

Played at real speed, whisper-base on WASM with a 1.5 second step, the confirmed text ran
**3.9 to 4.7 seconds** behind the speaker with one and a half to three seconds of audio
queued behind it. That is three or four times the budget I wrote down before measuring
anything, and I have left the original numbers below so the difference is visible.

The cause is the fixed cost of a pass. Whisper's encoder pads every window to thirty seconds,
so halving the window does not halve the work. Raising the step to 2.2 seconds made the lag
worse rather than better, because the lag is two steps plus two passes and the step is the
part you pay for twice.

Where that leaves it: on this laptop the loop sits at break-even, a real-time factor of 0.95
to 1.07 depending on the model. It keeps up, but only just, and a slower machine will not.
whisper-tiny buys about ten percent and costs noticeably more errors: it heard "my fellow
America" and "as not what your country can do". Getting this to a second of lag needs either
a real GPU or a model built for streaming, and that is a version 2 question rather than
something the window step can fix.

Note also that streaming costs several times what one pass costs. Transcribing the same clip
in one go is 0.28 real time; streaming it is 0.57 to 1.07, because every second of audio goes
through the model two or three times before it settles.

## First numbers

One laptop, AMD GCN5 GPU, 12 CPU threads, Chromium 152, one 11-second English clip,
whisper-base at q4. Median of four warm runs; the spread across runs is about 10%, and the
first run after loading a model is roughly 40% slower while shaders compile.

| Backend | Cross-origin isolated | Real-time factor |
| ------- | --------------------- | ---------------- |
| WASM    | yes                   | 0.28             |
| WASM    | no                    | 0.49             |
| WebGPU  | yes                   | 0.63             |
| WebGPU  | no                    | 0.62             |

Three things came out of this, and two of them were not what I expected.

Quantising the encoder to q4 is nearly three times faster than the fp32 encoder the
transformers.js examples use, and cuts the download from 206 MB to 142 MB. That is now the
default. The q8 decoder, which is the usual choice on WASM, does not load at all on this
onnxruntime version.

Cross-origin isolation is worth having. It lets onnxruntime start its WASM thread pool,
which nearly halves WASM inference. It costs nothing on WebGPU. The headers are
`COOP: same-origin` and `COEP: credentialless`; the credentialless variant is what lets the
model weights still come from a CDN, and Safari does not support it, so Safari runs
single-threaded.

And WASM on twelve cores beats this laptop's GPU by two to one. I would not have guessed
that, and I would have shipped `auto` picking WebGPU without checking. It still does, because
on a machine with a real GPU that is the right guess, but the backend is a visible setting
and the week 5 benchmark is what will settle it.

An earlier single run showed 0.23 on WebGPU and I nearly wrote it down. Repeated runs put it
at 0.62. One sample is not a measurement.

The number that actually matters for streaming is not the ratio, though. It is what a single
pass costs:

| Audio in the window | Inference |
| ------------------- | --------- |
| 2 s                 | 1.3 s     |
| 5 s                 | 1.4 s     |
| 11 s                | 2.1 s     |

Whisper's encoder always runs over a padded 30-second window, so a pass costs about 1.2
seconds whatever you feed it. That puts a floor under the window step: whisper-base cannot be
re-run more often than roughly every 1.3 seconds here, and the 600 ms end of the budget table
needs a smaller model.

## How the streaming part works

Whisper is not a streaming model. It reads a window of audio and writes the whole window out,
so the only way to get text while someone is still talking is to run it again and again over
a window that keeps moving, and then decide which part of each answer to believe.

The rule is local agreement: a word is printed as final once two consecutive passes put it in
the same place. Everything after that is shown as a guess, in amber, because it will change.
Silero voice activity detection sits in front, and its job is not to find word boundaries but
to stop the model running at all when nobody is talking, which is when Whisper starts
inventing "thank you for watching" out of room tone.

Two things that only turned up once it ran. The window has to keep a little audio behind the
first unconfirmed word, not cut flush against it: with a flush cut the model lost "Americans"
out of "my fellow Americans" every time, because the word arrived with no run-up. And word
level timestamps need the `_timestamped` model exports, which carry the cross-attentions that
the alignment is computed from; the ordinary exports throw.

## Status

Week 3 of six. What exists:

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

What does not exist yet: no export, no timestamps in the interface, no search, no benchmark
harness. Weeks 4 and 5.

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
packages/core   audio sources, resampling, WAV, voice activity, windowing, the stabiliser,
                the inference engine and both worker protocols
packages/app    Angular 22, zoneless, signals; owns the worklet asset and the two Workers
```

Audio sits behind an `AudioSource` adapter and the model behind a worker protocol. Neither
knows about the other, and neither knows whether a person or a fixture is on the far end.
That is what makes the week 5 accuracy run possible at all.

## Things it will not do

No speaker labels. Working out who said what needs a separate embedding model plus
clustering, and it fails loudly enough that people trust the whole transcript less. Maybe in
a second version.
