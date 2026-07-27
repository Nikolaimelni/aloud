# Aloud

Live speech transcription that runs entirely in the browser. The model is fetched once and
evaluated on your own machine, the audio never leaves the tab, and the transcript fills in
while you are still talking.

It is also unfinished. See Status before you clone it expecting a transcript.

## Why

Everything I could point at a work call wants the audio on someone else's server. That is a
reasonable trade for accuracy, and a bad one for a standup where somebody mentions a
customer by name. WebGPU and quantised Whisper have made the other trade viable: slower and
a few points worse, but nothing to upload and nothing to delete afterwards.

## Latency, honestly

Real-time here does not mean instant, and the arithmetic is worth writing down before the
first measurement exists.

| Stage            | Budget        | Why                                                                                              |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| Capture buffer   | ~60 ms        | Worklet frames plus resampling from 48 kHz to the 16 kHz the model wants                         |
| Voice activity   | ~100 ms       | The detector needs enough signal to tell speech from a chair creaking                            |
| Inference window | 600-1200 ms   | Whisper is an encoder-decoder over a window, not a streaming model. Window step is the real dial |
| Stabilisation    | one more step | A word is only printed as confirmed once two consecutive passes agree on it                      |

So the live hypothesis trails speech by roughly 0.7-1.3 s and confirmed text by another
window step. **These are design targets, not measurements.** Week 5 replaces this table with
numbers from the benchmark harness. If it turns out to be three seconds, the table will say
three seconds.

## Status

Week 0 of six. What exists:

- pnpm workspace, strict TypeScript, lint, CI
- `AudioWorklet` capture with a level meter, so the audio path is provably alive
- a polyphase resampler to 16 kHz with the anti-alias tests that justify writing one

What does not exist yet: the model, voice activity detection, windowing, the stabiliser, the
transcript. In other words, the transcription.

## Running it

Node 24 (see `.nvmrc`) and pnpm 10.

```
pnpm install
pnpm dev
```

Then allow the microphone and press Start. The meter should move. That is the whole feature
set today.

## Layout

```
packages/core   audio sources, resampling, and later VAD, chunking, the stabiliser
packages/app    Angular 22, zoneless, signals
```

The pipeline sits behind an `AudioSource` adapter. In the browser it reads a microphone; in
CI it will read a WAV file faster than real time, which is what makes accuracy measurable
without a human in the loop.

## Things it will not do

No speaker labels. Working out who said what needs a separate embedding model plus
clustering, and it fails loudly enough that people trust the whole transcript less. Maybe in
a second version.
