import * as z from 'zod';
import type { ModelSize } from '@aloud/core/asr/models';

const list = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

/**
 * Every knob the benchmark takes, parsed once. A typo in BENCH_STEP used to become NaN, which
 * switched the step check off and ran a pass on every frame without a word of complaint.
 */
const schema = z.object({
  BENCH_MODELS: list
    .pipe(z.array(z.enum(['tiny', 'base'] as const satisfies readonly ModelSize[])).min(1))
    .default(['tiny', 'base']),
  BENCH_DEVICES: list.pipe(z.array(z.enum(['wasm', 'webgpu'])).min(1)).default(['wasm']),
  /** q8 is what the app ships. q4 is the one to compare it with. */
  BENCH_DTYPE: z.enum(['q8', 'q4', 'fp16', 'fp32']).default('q8'),
  /** Seconds between guesses at the line being spoken, in the live runs. */
  BENCH_STEP: z.coerce.number().positive().default(0.6),
  /** Fixture ids that also get a live run at real speed. */
  BENCH_STREAM: list.default(['ted-60s']),
  BENCH_RUN_TIMEOUT: z.coerce.number().int().positive().default(300_000),
  /** Headless Chromium cannot get a GPU adapter here, so WebGPU needs a window. */
  BENCH_HEADED: z.stringbool().default(false),
});

export const env = schema.parse(process.env);
