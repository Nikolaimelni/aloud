export type RetryOptions = {
  readonly attempts?: number;
  /** Waits this long after the first failure, then twice that, and so on. */
  readonly backoffMs?: number;
};

const ATTEMPTS = 3;
const BACKOFF_MS = 400;

/**
 * Model weights are a hundred megabytes over somebody else's CDN, and a dropped connection
 * halfway through should cost a second rather than the session. Everything here is cached per
 * file, so a second attempt picks up what the first one already got.
 */
export async function retry<T>(work: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? ATTEMPTS;
  const backoff = options.backoffMs ?? BACKOFF_MS;
  let last: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await work();
    } catch (cause) {
      last = cause;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, backoff * 2 ** attempt));
      }
    }
  }

  throw last instanceof Error ? last : new Error(String(last));
}
