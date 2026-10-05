import { AloudError, type AloudErrorCode } from './errors';

type Message = { readonly kind: string; readonly id?: number };

type Failed = {
  readonly kind: 'failed';
  readonly id: number;
  readonly code: AloudErrorCode;
  readonly message: string;
};

type Pending<Reply> = {
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
};

/**
 * Request and reply over postMessage, matched by id. The ASR and VAD clients both sit on this,
 * so a failure comes back from either worker with its code and its cause intact.
 */
export class WorkerChannel<Request extends { readonly id: number }, Reply extends Message> {
  private nextId = 1;
  private readonly pending = new Map<number, Pending<Reply>>();
  /** A dead worker never answers, so a request posted to it would wait forever. */
  private dead: AloudError | null = null;

  private readonly worker: Worker;

  /** `unasked` gets whatever arrives without an id, such as download progress. */
  constructor(worker: Worker, name: string, unasked: (reply: Reply) => void = () => {}) {
    this.worker = worker;

    worker.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      const id = reply.id;
      const pending = id === undefined ? undefined : this.pending.get(id);
      if (id === undefined || !pending) {
        unasked(reply);
        return;
      }

      this.pending.delete(id);
      if (isFailed(reply)) {
        pending.reject(new AloudError(reply.code, reply.message));
      } else {
        pending.resolve(reply);
      }
    };
    // Both handlers catch everything they do and answer with `failed`, so reaching this means
    // the worker itself is broken: its module did not load, or it ran out of memory.
    worker.onerror = () => {
      this.failAll(new AloudError('worker-died', `the ${name} worker died`));
    };
  }

  request(build: (id: number) => Request, transfer: Transferable[] = []): Promise<Reply> {
    if (this.dead) return Promise.reject(this.dead);

    const request = build(this.nextId++);
    return new Promise((resolve, reject) => {
      this.worker.postMessage(request, transfer);
      this.pending.set(request.id, { resolve, reject });
    });
  }

  dispose(): void {
    this.failAll(new AloudError('worker-died', 'the client was disposed'));
    this.worker.terminate();
  }

  private failAll(error: AloudError): void {
    this.dead = error;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function isFailed(reply: Message): reply is Failed {
  return reply.kind === 'failed';
}
