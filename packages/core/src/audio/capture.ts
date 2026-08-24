import { AloudError } from '../errors';
import { Resampler } from './resample';
import { TARGET_SAMPLE_RATE, type AudioSource, type FrameHandler } from './source';

export type CaptureOptions = {
  /** Where the capture worklet lives. The app owns the asset, core only loads it. */
  readonly workletUrl: string;
  readonly open: () => Promise<MediaStream>;
  /**
   * The browser suspends the audio graph when a tab goes to the background, and on a phone
   * that happens the moment someone answers a message. Frames simply stop; without this the
   * interface would sit there looking like it was still listening.
   */
  readonly onRunningChange?: (running: boolean) => void;
};

/**
 * Anything the browser will hand over as a `MediaStream`: a microphone, a shared tab, later
 * whatever else. The graph, the resampler and the frame timing are identical, so they live
 * here once and the two factories below only differ in how they ask for permission.
 */
export class MediaCapture implements AudioSource {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private done: () => void = () => {};

  readonly finished = new Promise<void>((resolve) => {
    this.done = resolve;
  });

  private readonly options: CaptureOptions;

  constructor(options: CaptureOptions) {
    this.options = options;
  }

  /** What the device actually gave us, once running. Rarely 16 kHz, hence the resampler. */
  get deviceSampleRate(): number | null {
    return this.context?.sampleRate ?? null;
  }

  /** Ask the browser to pick the graph back up, for when a tab comes to the foreground. */
  async resume(): Promise<void> {
    await this.context?.resume();
  }

  async start(onFrame: FrameHandler): Promise<void> {
    if (this.context) {
      throw new AloudError('capture-failed', 'source is already running');
    }

    this.stream = await this.options.open();

    // An AudioContext will happily resample to 16 kHz for us, but then live audio and the
    // WAV fixtures in CI would travel through different code. One resampler, ours, always.
    const context = new AudioContext();
    this.context = context;

    try {
      await context.audioWorklet.addModule(this.options.workletUrl);
    } catch (cause) {
      await this.stop();
      throw new AloudError('worklet-load-failed', 'capture worklet did not load', { cause });
    }

    const resampler = new Resampler(context.sampleRate);
    const delay = resampler.delaySamples / TARGET_SAMPLE_RATE;
    let produced = 0;

    const node = new AudioWorkletNode(context, 'capture');
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const samples = resampler.process(event.data);
      if (samples.length === 0) return;
      void onFrame({ samples, time: Math.max(0, produced / TARGET_SAMPLE_RATE - delay) });
      produced += samples.length;
    };
    this.node = node;

    // The worklet writes nothing to its output; the chain exists so the graph keeps
    // scheduling it, and the silent gain makes sure of it if that ever changes.
    const sink = new GainNode(context, { gain: 0 });
    context.createMediaStreamSource(this.stream).connect(node).connect(sink);
    sink.connect(context.destination);

    context.onstatechange = () => {
      this.options.onRunningChange?.(context.state === 'running');
    };

    await context.resume();
  }

  async stop(): Promise<void> {
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    const context = this.context;
    this.context = null;
    await context?.close();

    this.done();
  }
}

export function microphone(
  workletUrl: string,
  options: { deviceId?: string; onRunningChange?: (running: boolean) => void } = {},
): MediaCapture {
  const { deviceId } = options;
  return new MediaCapture({
    workletUrl,
    ...(options.onRunningChange ? { onRunningChange: options.onRunningChange } : {}),
    open: async () => {
      const audio: MediaTrackConstraints = { channelCount: 1 };
      if (deviceId) {
        audio.deviceId = { exact: deviceId };
      }

      try {
        return await navigator.mediaDevices.getUserMedia({ audio });
      } catch (cause) {
        throw new AloudError(
          denied(cause) ? 'capture-denied' : 'capture-failed',
          'could not open the microphone',
          { cause },
        );
      }
    },
  });
}

/**
 * The sound of another tab, which is the whole reason this project is useful on a real call.
 * Chrome will not offer the audio checkbox unless video is asked for too, so it is requested
 * and then thrown away.
 */
export function tabAudio(
  workletUrl: string,
  options: { onRunningChange?: (running: boolean) => void } = {},
): MediaCapture {
  return new MediaCapture({
    workletUrl,
    ...(options.onRunningChange ? { onRunningChange: options.onRunningChange } : {}),
    open: async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          video: true,
        });
      } catch (cause) {
        throw new AloudError(
          denied(cause) ? 'capture-denied' : 'capture-failed',
          'could not capture the tab',
          { cause },
        );
      }

      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
      }

      if (stream.getAudioTracks().length === 0) {
        throw new AloudError(
          'capture-failed',
          'that share has no sound. Pick a tab and tick "share tab audio"',
        );
      }

      return stream;
    },
  });
}

function denied(cause: unknown): boolean {
  return (
    cause instanceof DOMException &&
    (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
  );
}
