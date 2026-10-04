/** Nothing at all for this long and the connection is gone, however slow the network is. */
const STALL_MS = 30_000;

/**
 * fetch that gives up when the bytes stop. A connection that stalls never throws, so retry()
 * would wait on it forever. A fixed deadline would also kill a slow phone halfway through the
 * weights; this one restarts with every chunk, so only silence trips it.
 */
export async function fetchUnlessStalled(
  input: string | URL,
  init: RequestInit = {},
  stallMs: number = STALL_MS,
): Promise<Response> {
  const controller = new AbortController();
  const stalled = () => controller.abort(new Error(`no data for ${stallMs / 1000} s`));
  let timer = setTimeout(stalled, stallMs);
  const rearm = () => {
    clearTimeout(timer);
    timer = setTimeout(stalled, stallMs);
  };

  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  let response: Response;
  try {
    response = await fetch(input, { ...init, signal });
  } finally {
    clearTimeout(timer);
  }

  if (!response.body) return response;

  rearm();
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, output) {
        rearm();
        output.enqueue(chunk);
      },
      flush() {
        clearTimeout(timer);
      },
    }),
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
