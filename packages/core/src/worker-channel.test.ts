import { describe, expect, it } from 'vitest';
import { WorkerChannel } from './worker-channel';

type Ping = { readonly kind: 'ping'; readonly id: number };
type Pong = { readonly kind: 'pong'; readonly id: number };

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  postMessage(): void {}
  terminate(): void {}

  reply(id: number): void {
    this.onmessage?.(new MessageEvent('message', { data: { kind: 'pong', id } }));
  }
}

function channelOn(worker: FakeWorker): WorkerChannel<Ping, Pong> {
  return new WorkerChannel(worker as unknown as Worker, 'test');
}

const ping = (id: number): Ping => ({ kind: 'ping', id });

describe('WorkerChannel', () => {
  it('matches each reply to its request, whatever order they come in', async () => {
    const worker = new FakeWorker();
    const channel = channelOn(worker);
    const first = channel.request(ping);
    const second = channel.request(ping);

    worker.reply(2);
    worker.reply(1);

    expect(await first).toEqual({ kind: 'pong', id: 1 });
    expect(await second).toEqual({ kind: 'pong', id: 2 });
  });

  it('fails what is waiting and everything after once the worker dies', async () => {
    const worker = new FakeWorker();
    const channel = channelOn(worker);
    const waiting = channel.request(ping);

    worker.onerror?.();

    await expect(waiting).rejects.toMatchObject({ code: 'worker-died' });
    await expect(channel.request(ping)).rejects.toThrow('the test worker died');
    expect(channel.alive).toBe(false);
  });
});
