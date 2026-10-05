/**
 * Moonshine rather than Whisper: it is made for live English, it reads a two-second line in a
 * fraction of what Whisper spends padding every window to thirty seconds, and at q8 tiny is
 * 32 MB against whisper-base's 149. It knows English only, which is all this app does.
 *
 * Revisions are pinned because the numbers in the README were measured on these weights and
 * `main` can move under them. Sizes are megabytes at q8, encoder, decoder and tokenizer.
 */
export const MODELS = {
  tiny: {
    id: 'onnx-community/moonshine-tiny-ONNX',
    revision: 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95',
    sizeMb: 32,
  },
  base: {
    id: 'onnx-community/moonshine-base-ONNX',
    revision: 'b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad',
    sizeMb: 67,
  },
} as const;

export type ModelSize = keyof typeof MODELS;

export const MODEL_SIZES = Object.keys(MODELS) as ModelSize[];

export function isModelSize(value: string): value is ModelSize {
  return Object.hasOwn(MODELS, value);
}
