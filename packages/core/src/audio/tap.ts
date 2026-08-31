import type { AudioFrame, AudioSource } from './source';

/**
 * Wraps a source so the level meter and the recorder can watch the frames going past. The
 * pipeline downstream cannot tell the difference.
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
