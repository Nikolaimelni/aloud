import { describe, expect, it } from 'vitest';
import { AloudError } from '../errors';
import { decodeWav } from './wav';

interface WavSpec {
  sampleRate: number;
  bits: number;
  code?: number;
  channels: Float32Array[];
  /** Slip a chunk between fmt and data, the way real recorders do. */
  extraChunk?: boolean;
  /** Lie about how many bytes of audio follow. */
  declaredDataBytes?: number;
}

function buildWav(spec: WavSpec): ArrayBuffer {
  const { sampleRate, bits, code = 1, channels, extraChunk = false } = spec;
  const stride = bits / 8;
  const frames = channels[0].length;
  const dataBytes = frames * channels.length * stride;
  const listBytes = extraChunk ? 18 : 0;

  const buffer = new ArrayBuffer(12 + 24 + listBytes + 8 + dataBytes);
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
  u16(code);
  u16(channels.length);
  u32(sampleRate);
  u32(sampleRate * channels.length * stride);
  u16(channels.length * stride);
  u16(bits);

  if (extraChunk) {
    ascii('LIST');
    u32(10);
    at += 10;
  }

  ascii('data');
  u32(spec.declaredDataBytes ?? dataBytes);
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      writeSample(view, at, channel[frame], bits, code);
      at += stride;
    }
  }

  return buffer;
}

function writeSample(view: DataView, at: number, value: number, bits: number, code: number): void {
  if (code === 3) {
    view.setFloat32(at, value, true);
    return;
  }
  switch (bits) {
    case 8:
      view.setUint8(at, Math.round(value * 127) + 128);
      return;
    case 16:
      view.setInt16(at, Math.round(value * 32767), true);
      return;
    case 24: {
      const scaled = Math.round(value * 8388607);
      view.setUint8(at, scaled & 0xff);
      view.setUint8(at + 1, (scaled >> 8) & 0xff);
      view.setUint8(at + 2, (scaled >> 16) & 0xff);
      return;
    }
    default:
      view.setInt32(at, Math.round(value * 2147483647), true);
  }
}

function ramp(length: number, scale = 1): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = scale * Math.sin(i / 3);
  return out;
}

describe('decodeWav', () => {
  it('reads 16-bit mono', () => {
    const source = ramp(64);
    const decoded = decodeWav(buildWav({ sampleRate: 16_000, bits: 16, channels: [source] }));

    expect(decoded.sampleRate).toBe(16_000);
    expect(decoded.channels).toBe(1);
    expect(decoded.samples.length).toBe(64);
    for (let i = 0; i < source.length; i++) {
      expect(decoded.samples[i]).toBeCloseTo(source[i], 4);
    }
  });

  it('mixes channels down to mono', () => {
    const left = ramp(32, 0.5);
    const right = left.map((value) => -value);
    const decoded = decodeWav(
      buildWav({ sampleRate: 48_000, bits: 16, channels: [left, right] }),
    );

    expect(decoded.channels).toBe(2);
    for (const sample of decoded.samples) {
      expect(Math.abs(sample)).toBeLessThan(1e-4);
    }
  });

  it('walks past chunks it does not care about', () => {
    const source = ramp(16);
    const decoded = decodeWav(
      buildWav({ sampleRate: 44_100, bits: 16, channels: [source], extraChunk: true }),
    );

    expect(decoded.sampleRate).toBe(44_100);
    expect(decoded.samples.length).toBe(16);
    expect(decoded.samples[5]).toBeCloseTo(source[5], 4);
  });

  it('reads 32-bit float', () => {
    const source = ramp(32);
    const decoded = decodeWav(
      buildWav({ sampleRate: 16_000, bits: 32, code: 3, channels: [source] }),
    );

    for (let i = 0; i < source.length; i++) {
      expect(decoded.samples[i]).toBeCloseTo(source[i], 6);
    }
  });

  it('reads 24-bit', () => {
    const source = ramp(32);
    const decoded = decodeWav(buildWav({ sampleRate: 16_000, bits: 24, channels: [source] }));

    for (let i = 0; i < source.length; i++) {
      expect(decoded.samples[i]).toBeCloseTo(source[i], 5);
    }
  });

  it('trusts the file over the declared data size', () => {
    const decoded = decodeWav(
      buildWav({
        sampleRate: 16_000,
        bits: 16,
        channels: [ramp(40)],
        declaredDataBytes: 0xffffffff,
      }),
    );

    expect(decoded.samples.length).toBe(40);
  });

  it('rejects something that is not a WAV at all', () => {
    expect(() => decodeWav(new ArrayBuffer(128))).toThrow(
      expect.objectContaining({ code: 'invalid-wav' }),
    );
  });

  it('rejects a codec it cannot read', () => {
    const buffer = buildWav({ sampleRate: 8000, bits: 8, code: 7, channels: [ramp(16)] });
    expect(() => decodeWav(buffer)).toThrow(AloudError);
    expect(() => decodeWav(buffer)).toThrow(
      expect.objectContaining({ code: 'unsupported-wav-format' }),
    );
  });
});
