import { createVadHandler } from '@aloud/core/vad/serve';
import type { VadRequest } from '@aloud/core/vad/protocol';

const handle = createVadHandler((event) => {
  postMessage(event);
});

addEventListener('message', (event: MessageEvent<VadRequest>) => {
  void handle(event.data);
});
