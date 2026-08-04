import { createAsrHandler } from '@aloud/core/asr/serve';
import type { AsrRequest } from '@aloud/core/asr/protocol';

const handle = createAsrHandler((event) => {
  postMessage(event);
});

addEventListener('message', (event: MessageEvent<AsrRequest>) => {
  void handle(event.data);
});
