import { Resampler } from '@aloud/core/audio/resample';
import { TARGET_SAMPLE_RATE, type AudioFrame } from '@aloud/core/audio/source';
import { WavSource } from '@aloud/core/audio/wav-source';

/**
 * WAV goes through the same source adapter the live pipeline uses, so the file path and the
 * microphone path share their resampling. Anything else is handed to the browser's decoder,
 * which knows about MP3 and AAC and is not something worth reimplementing.
 */
export async function decodeToMono16k(file: File): Promise<Float32Array> {
  const data = await file.arrayBuffer();

  if (isRiff(data)) {
    return collect(new WavSource({ data }));
  }

  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(data);
    return new Resampler(decoded.sampleRate).process(downmix(decoded));
  } finally {
    await context.close();
  }
}

function isRiff(data: ArrayBuffer): boolean {
  if (data.byteLength < 4) return false;
  const view = new DataView(data);
  return view.getUint32(0, false) === 0x52494646;
}

async function collect(source: WavSource): Promise<Float32Array> {
  const frames: AudioFrame[] = [];
  await source.start((frame) => frames.push(frame));
  await source.finished;

  const out = new Float32Array(frames.reduce((total, frame) => total + frame.samples.length, 0));
  let at = 0;
  for (const frame of frames) {
    out.set(frame.samples, at);
    at += frame.samples.length;
  }
  return out;
}

function downmix(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < mono.length; i++) {
      mono[i] += data[i];
    }
  }
  for (let i = 0; i < mono.length; i++) {
    mono[i] /= buffer.numberOfChannels;
  }
  return mono;
}

export function secondsOf(samples: Float32Array): number {
  return samples.length / TARGET_SAMPLE_RATE;
}
