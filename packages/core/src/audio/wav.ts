import { AloudError } from '../errors';

export type DecodedWav = {
  readonly sampleRate: number;
  /** How many channels the file had before we mixed them down. */
  readonly channels: number;
  /** Mono, in [-1, 1]. */
  readonly samples: Float32Array;
};

const PCM = 0x0001;
const IEEE_FLOAT = 0x0003;
const EXTENSIBLE = 0xfffe;

type WavFormat = {
  code: number;
  channels: number;
  sampleRate: number;
  bits: number;
};

/**
 * Enough of RIFF to read the fixtures the benchmark runs on. Deliberately not a general
 * decoder: the browser has `decodeAudioData` for anything exotic, and CI has no browser.
 */
export function decodeWav(data: ArrayBuffer): DecodedWav {
  const view = new DataView(data);
  if (data.byteLength < 12 || chunkId(view, 0) !== 'RIFF' || chunkId(view, 8) !== 'WAVE') {
    throw new AloudError('invalid-wav', 'not a RIFF/WAVE file');
  }

  let format: WavFormat | null = null;
  let body: { start: number; length: number } | null = null;

  let at = 12;
  while (at + 8 <= data.byteLength) {
    const id = chunkId(view, at);
    const size = view.getUint32(at + 4, true);
    const start = at + 8;

    if (id === 'fmt ' && size >= 16) {
      format = readFormat(view, start, size);
    } else if (id === 'data') {
      // Streamed files sometimes declare a size they never wrote, or none at all.
      body = { start, length: Math.min(size, data.byteLength - start) };
    }

    at = start + size + (size % 2);
  }

  if (!format || !body) {
    throw new AloudError('invalid-wav', 'file has no fmt or data chunk');
  }

  return {
    sampleRate: format.sampleRate,
    channels: format.channels,
    samples: readSamples(view, format, body.start, body.length),
  };
}

function chunkId(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

function readFormat(view: DataView, at: number, size: number): WavFormat {
  let code = view.getUint16(at, true);
  if (code === EXTENSIBLE && size >= 40) {
    // WAVE_FORMAT_EXTENSIBLE keeps the real code in the first two bytes of a GUID.
    code = view.getUint16(at + 24, true);
  }
  return {
    code,
    channels: view.getUint16(at + 2, true),
    sampleRate: view.getUint32(at + 4, true),
    bits: view.getUint16(at + 14, true),
  };
}

function readSamples(
  view: DataView,
  format: WavFormat,
  start: number,
  length: number,
): Float32Array {
  const read = sampleReader(format);
  const stride = format.bits / 8;
  const channels = format.channels;
  const frames = Math.floor(length / (stride * channels));
  const out = new Float32Array(frames);

  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      sum += read(view, start + (frame * channels + channel) * stride);
    }
    out[frame] = sum / channels;
  }

  return out;
}

function sampleReader(format: WavFormat): (view: DataView, at: number) => number {
  if (format.channels < 1 || (format.bits !== 8 && format.bits % 8 !== 0)) {
    throw new AloudError('unsupported-wav-format', 'nonsensical channel count or bit depth');
  }

  if (format.code === IEEE_FLOAT && format.bits === 32) {
    return (view, at) => view.getFloat32(at, true);
  }

  if (format.code === PCM) {
    switch (format.bits) {
      case 8:
        return (view, at) => (view.getUint8(at) - 128) / 128;
      case 16:
        return (view, at) => view.getInt16(at, true) / 32768;
      case 24:
        return (view, at) =>
          ((view.getInt8(at + 2) << 16) | (view.getUint8(at + 1) << 8) | view.getUint8(at)) /
          8388608;
      case 32:
        return (view, at) => view.getInt32(at, true) / 2147483648;
    }
  }

  throw new AloudError(
    'unsupported-wav-format',
    `format ${format.code} at ${format.bits} bits is not one of the four we read`,
  );
}

/**
 * The other direction: mono 16-bit PCM, which is what every player and every transcription
 * tool will read, and half the size of keeping the floats.
 */
export function encodeWav(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
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
  u16(PCM);
  u16(1);
  u32(sampleRate);
  u32(sampleRate * 2);
  u16(2);
  u16(16);

  ascii('data');
  u32(samples.length * 2);
  for (const sample of samples) {
    view.setInt16(at, sample, true);
    at += 2;
  }

  return buffer;
}
