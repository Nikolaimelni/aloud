import * as z from 'zod';
import type { WhisperSize } from '@aloud/core/asr/models';

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
    .pipe(
      z.array(z.enum(['tiny', 'base', 'small'] as const satisfies readonly WhisperSize[])).min(1),
    )
    .default(['tiny', 'base']),
  BENCH_DEVICES: list.pipe(z.array(z.enum(['wasm', 'webgpu'])).min(1)).default(['wasm', 'webgpu']),
  BENCH_STEP: z.coerce.number().positive().default(1.5),
  /** Fixture ids that also get a real-speed streaming run. */
  BENCH_STREAM: list.default(['ted-60s', 'ru-03']),
  BENCH_RUN_TIMEOUT: z.coerce.number().int().positive().default(300_000),
  /** Headless Chromium cannot get a GPU adapter here, so WebGPU needs a window. */
  BENCH_HEADED: z.stringbool().default(false),
});

export const env = schema.parse(process.env);
