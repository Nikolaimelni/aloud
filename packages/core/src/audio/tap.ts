import type { AudioFrame, AudioSource } from './source';

/**
 * Wraps a source so something else can watch the frames going past: a level meter, a
 * recorder, a debug log. The pipeline downstream cannot tell the difference.
 */
export function tapFrames(source: AudioSource, watch: (frame: AudioFrame) => void): AudioSource {
  return {
    finished: source.finished,
    start: (onFrame) =>
      source.start((frame) => {
        watch(frame);
        return onFrame(frame);
      }),
    stop: () => source.stop(),
  };
}
