/**
 * The `_timestamped` exports carry cross-attentions, which is the only way to get a time per
 * word rather than per phrase, and the stabiliser needs word times to know how much audio it
 * can stop carrying.
 *
 * Revisions are pinned because the numbers in the README were measured on these weights and
 * `main` can move under them. Sizes are megabytes at q4, measured from the repos; the quantised
 * decoder is most of it, which is why tiny is not the saving it sounds like.
 */
export const WHISPER_MODELS = {
  tiny: {
    id: 'onnx-community/whisper-tiny_timestamped',
    revision: '517244293732ee2d58139af5814231b7e6830a0d',
    sizeMb: 96,
  },
  base: {
    id: 'onnx-community/whisper-base_timestamped',
    revision: '608c49e61301901684bc36cac8f74b95ff6b5a8e',
    sizeMb: 143,
  },
  small: {
    id: 'onnx-community/whisper-small_timestamped',
    revision: '65caa70f294b46e1c33ff820aae6b16d048ab818',
    sizeMb: 300,
  },
} as const;

export type WhisperSize = keyof typeof WHISPER_MODELS;

export const WHISPER_SIZES = Object.keys(WHISPER_MODELS) as WhisperSize[];

export function isWhisperSize(value: string): value is WhisperSize {
  return Object.hasOwn(WHISPER_MODELS, value);
}
