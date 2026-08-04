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

Real-time here does not mean instant. This is the budget the design is aimed at.

| Stage            | Budget        | Why                                                                                              |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| Capture buffer   | ~60 ms        | Worklet frames plus resampling from 48 kHz to the 16 kHz the model wants                         |
| Voice activity   | ~100 ms       | The detector needs enough signal to tell speech from a chair creaking                            |
| Inference window | 600-1200 ms   | Whisper is an encoder-decoder over a window, not a streaming model. Window step is the real dial |
| Stabilisation    | one more step | A word is only printed as confirmed once two consecutive passes agree on it                      |

The first measurements say the low end of that window row is wishful. See below.

## First numbers

One laptop, AMD GCN5 GPU, Chromium 152, one 11-second English clip. This is not the
benchmark harness, which arrives in week 5 with several languages and a word error rate.
It is enough to know whether the idea works at all.

| Model        | Backend | Weights                  | Inference | Real-time factor                       |
| ------------ | ------- | ------------------------ | --------- | -------------------------------------- |
| whisper-tiny | WebGPU  | fp32 encoder, q4 decoder | 1.7 s     | 0.15                                   |
| whisper-base | WebGPU  | q4                       | 2.5 s     | 0.23                                   |
| whisper-base | WebGPU  | fp32 encoder, q4 decoder | 7.0 s     | 0.63                                   |
| whisper-base | WASM    | q4                       | 6.1 s     | 0.55                                   |
| whisper-base | WASM    | q8                       |           | onnxruntime will not build the session |

Two surprises. Quantising the encoder to q4 made it nearly three times faster than the fp32
encoder the transformers.js examples use, and cut the download from 206 MB to 142 MB, so q4
is now the default. And the q8 decoder, which is the usual WASM choice, does not load at all
on this onnxruntime version.

The number that actually matters for streaming is not the ratio, though. It is what a single
pass costs:

| Audio in the window | Inference |
| ------------------- | --------- |
| 2 s                 | 1.3 s     |
| 5 s                 | 1.4 s     |
| 11 s                | 2.1 s     |

Whisper's encoder always runs over a padded 30-second window, so a pass costs about 1.2
seconds whatever you feed it. That puts a floor under the window step: on this machine,
whisper-base cannot be re-run more often than roughly every 1.3 seconds, and the 600 ms end
of the budget table needs a smaller model. Week 2 has to design around that rather than
hope.

## Status

Week 1 of six. What exists:

- pnpm workspace, strict TypeScript, lint, CI
- `AudioWorklet` capture with a level meter
- a polyphase resampler to 16 kHz, with the anti-alias tests that justify writing one
- a WAV reader and a file-backed `AudioSource`, so the pipeline can run without a browser
- Whisper in a worker on WebGPU or WASM, transcribing a whole file and reporting its cost

What does not exist yet: voice activity detection, windowing, the stabiliser, and therefore
anything live. You can transcribe a file. You cannot yet talk to it.

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
packages/core   audio sources, resampling, WAV, the inference engine and its worker protocol
packages/app    Angular 22, zoneless, signals; owns the worklet asset and the Worker
```

Audio sits behind an `AudioSource` adapter and the model behind a worker protocol. Neither
knows about the other, and neither knows whether a person or a fixture is on the far end.
That is what makes the week 5 accuracy run possible at all.

## Things it will not do

No speaker labels. Working out who said what needs a separate embedding model plus
clustering, and it fails loudly enough that people trust the whole transcript less. Maybe in
a second version.
