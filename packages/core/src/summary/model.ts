/**
 * Facts about the embedding model, kept away from the module that loads it. Importing a
 * constant out of `embed.ts` drags transformers.js into whatever bundle asked, which turned
 * the app's initial chunk from 270 kB into 807 kB the one time it was tried.
 */
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';

/** English only. The multilingual model is 118 MB, which is a lot for a secondary feature. */
export const EMBEDDING_SIZE_MB = 23;
