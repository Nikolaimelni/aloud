import { describe, expect, it } from 'vitest';
import { WavSource } from './wav-source';
import type { AudioFrame } from './source';

/** Minimal 16-bit mono WAV, written by hand so the test does not lean on the decoder's twin. */
function wav(sampleRate: number, seconds: number): ArrayBuffer {
  const frames = Math.round(sampleRate * seconds);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  let at = 0;

  const ascii = (text: string) => {
    for (const character of text) view.setUint8(at++, character.charCodeAt(0));
  };
  const u32 = (value: number) => {
    view.setUint32(at, value, true);
    at += 4;
  };
  const u16 = (value: number) => {
    view.setUint16(at, value, true);
    at += 2;
  };

  ascii('RIFF');
  u32(buffer.byteLength - 8);
  ascii('WAVE');
  ascii('fmt ');
  u32(16);
  u16(1);
  u16(1);
  u32(sampleRate);
  u32(sampleRate * 2);
  u16(2);
  u16(16);
  ascii('data');
  u32(frames * 2);

  for (let i = 0; i < frames; i++) {
    view.setInt16(
      44 + i * 2,
      Math.round(16000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)),
      true,
    );
  }

  return buffer;
}

async function collect(source: WavSource): Promise<AudioFrame[]> {
  const frames: AudioFrame[] = [];
  await source.start((frame) => {
    frames.push(frame);
  });
  await source.finished;
  return frames;
}

describe('WavSource', () => {
  it('delivers a whole file at 16 kHz', async () => {
    const frames = await collect(new WavSource({ data: wav(48_000, 2) }));
    const total = frames.reduce((count, frame) => count + frame.samples.length, 0);

    expect(total).toBe(32_000);
  });

  it('resamples 44.1 kHz on the way through', async () => {
    const frames = await collect(new WavSource({ data: wav(44_100, 1) }));
    const total = frames.reduce((count, frame) => count + frame.samples.length, 0);

    expect(total).toBe(16_000);
  });

  it('hands out timestamps that line up end to end', async () => {
    const frames = await collect(new WavSource({ data: wav(16_000, 1) }));

    let expected = 0;
    for (const frame of frames) {
      expect(frame.time).toBeCloseTo(Math.max(0, expected / 16_000 - 32 / 16_000), 6);
      expected += frame.samples.length;
    }
  });

  it('stops early when asked', async () => {
    const source = new WavSource({ data: wav(16_000, 30), speed: 1 });
    let frames = 0;

    await source.start(() => {
      frames++;
      if (frames === 3) void source.stop();
    });
    await source.finished;

    expect(frames).toBeLessThan(10);
  });
});
