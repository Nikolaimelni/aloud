/** Quietest thing the meter bothers to draw. Below this it is all floor noise anyway. */
const FLOOR_DB = -60;

/**
 * A number between 0 and 1 for a level meter, by way of dBFS. A linear RMS meter looks dead
 * below half volume, because hearing is not linear and neither is speech: normal talking sits
 * around a tenth of full scale.
 */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }

  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }

  const rms = Math.sqrt(sum / samples.length);
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}
