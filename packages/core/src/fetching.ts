/** How a worker gets the files it needs. Both workers take this, so it lives with neither. */
export type Fetching = {
  /** Where the page serves onnxruntime's wasm. Left out, it comes from jsDelivr. */
  readonly runtimeUrl?: string;
  /** False: the files are held in memory and nothing is written to the device. */
  readonly keep?: boolean;
};

/**
 * The Cache Storage cache transformers.js keeps the models in, and the detector's weights go in
 * with them. It is transformers.js's own default, named here so the page can measure it and
 * empty it without importing transformers.js.
 */
export const MODEL_CACHE = 'transformers-cache';
