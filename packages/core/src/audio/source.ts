/** Everything downstream of capture assumes this rate. Whisper accepts nothing else. */
export const TARGET_SAMPLE_RATE = 16_000;

export interface AudioFrame {
  /** Mono PCM in [-1, 1] at TARGET_SAMPLE_RATE. */
  readonly samples: Float32Array;
  /** Seconds from the start of the source to the first sample of this frame. */
  readonly time: number;
}

export type FrameHandler = (frame: AudioFrame) => void;

/**
 * The pipeline never learns where audio came from. In the browser this is a microphone
 * or a captured tab; in CI it is a WAV file pushed through faster than real time.
 */
export interface AudioSource {
  /** Resolves once audio is flowing, not once it has all arrived. */
  start(onFrame: FrameHandler): Promise<void>;
  stop(): Promise<void>;
  /** Resolves when no more frames are coming: the file ran out, or stop() was called. */
  readonly finished: Promise<void>;
}
