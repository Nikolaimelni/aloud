import { AloudError } from '../errors';
import { Resampler } from './resample';
import { TARGET_SAMPLE_RATE, type AudioSource, type FrameHandler } from './source';

export interface MicSourceOptions {
  /** Where the capture worklet lives. The app owns the asset, core only loads it. */
  readonly workletUrl: string;
  readonly deviceId?: string;
}

export class MicSource implements AudioSource {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private done: () => void = () => {};

  readonly finished = new Promise<void>((resolve) => {
    this.done = resolve;
  });

  constructor(private readonly options: MicSourceOptions) {}

  /** What the device actually gave us, once running. Rarely 16 kHz, hence the resampler. */
  get deviceSampleRate(): number | null {
    return this.context?.sampleRate ?? null;
  }

  async start(onFrame: FrameHandler): Promise<void> {
    if (this.context) {
      throw new AloudError('capture-failed', 'source is already running');
    }

    const constraints: MediaTrackConstraints = { channelCount: 1 };
    if (this.options.deviceId) {
      constraints.deviceId = { exact: this.options.deviceId };
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    } catch (cause) {
      const denied =
        cause instanceof DOMException &&
        (cause.name === 'NotAllowedError' || cause.name === 'SecurityError');
      throw new AloudError(
        denied ? 'capture-denied' : 'capture-failed',
        'could not open the microphone',
        { cause },
      );
    }

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
      onFrame({ samples, time: Math.max(0, produced / TARGET_SAMPLE_RATE - delay) });
      produced += samples.length;
    };
    this.node = node;

    // The worklet writes nothing to its output; the chain exists so the graph keeps
    // scheduling it, and the silent gain makes sure of it if that ever changes.
    const sink = new GainNode(context, { gain: 0 });
    context.createMediaStreamSource(this.stream).connect(node).connect(sink);
    sink.connect(context.destination);

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
